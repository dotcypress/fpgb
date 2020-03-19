use byteorder::{BigEndian, ByteOrder};
use core::fmt::Write;
use core::str;
use wire4::*;

use crate::breadboard::{self, Breadboard, NETS};
use crate::breadboard::{resolve_net_name, resolve_port_name};
use crate::config::*;
use crate::hal::prelude::*;
use crate::shell::{self, Shell};

#[derive(Debug)]
pub enum Error {
    AdcError,
    VMError(VMError),
    StoreError(StoreError),
    BadInput(core::str::Utf8Error),
    FormatError(core::fmt::Error),
    SerialError(hal::serial::Error),
    BreadboardError(breadboard::Error),
}

pub struct FPGB {
    shell: Shell,
    vm: Wire4VM,
    store: EepromStore,
    bb: Breadboard,
    delay: VmDelay,
    adc: Adc,
    adc_pin: AdcPin,
    dac: Dac,
}

impl FPGB {
    pub fn new(
        delay: VmDelay,
        serial: Serial,
        dac: Dac,
        adc: Adc,
        adc_pin: AdcPin,
        matrix: SwitchMatrix,
        store: EepromStore,
    ) -> FPGB {
        FPGB {
            store,
            delay,
            dac,
            adc,
            adc_pin,
            vm: Wire4VM::new(),
            bb: Breadboard::new(matrix),
            shell: Shell::new(serial),
        }
    }

    pub fn reset(&mut self) -> Result<(), Error> {
        self.vm.reset();
        self.bb.reset().map_err(Error::BreadboardError)?;
        self.shell.stop_rec();
        if self.contains_var(vars::BOOT)? {
            self.vm
                .push(Value::Var(vars::BOOT))
                .map_err(Error::VMError)?;
            if let Err(err) = self.call_proc(proc::EVAL) {
                self.vm.reset();
                self.bb.reset().map_err(Error::BreadboardError)?;
                write!(self.shell, "ERR: Boot failed {:?}\r\n", err).map_err(Error::FormatError)?;
            }
        }
        Ok(())
    }

    pub fn poll_serial(&mut self) {
        loop {
            match self.shell.poll() {
                Ok(byte) => {
                    if let Err(err) = self.handle_byte(byte) {
                        write!(self.shell, "ERR: {:?}\r\n", err).expect("Serial port fault");
                    }
                }
                Err(hal::nb::Error::WouldBlock) => {
                    return;
                }
                Err(err) => {
                    write!(self.shell, "ERR: Serial {:?}\r\n", err).expect("Serial port fault")
                }
            }
        }
    }

    pub fn spin(&mut self) {
        if let Err(err) = self.tick() {
            self.shell.hide_status();
            write!(self.shell, "ERR: {:?}\r\n", err).expect("Serial port fault");
        }
    }

    fn handle_byte(&mut self, byte: u8) -> Result<(), Error> {
        match byte {
            shell::KEY_DC1 => {
                self.shell.activate_promt();
                write!(self.shell, "{:?} ", self.vm).map_err(Error::FormatError)?
            }
            shell::KEY_DC2 => {
                self.shell.print_banner().map_err(Error::FormatError)?;
                self.shell.reset();
                self.reset()?;
            }
            shell::KEY_DC3 => {
                if let Some(var) = self.shell.get_rec() {
                    if self.shell.get_buf().len() > 0 {
                        self.store
                            .insert(&self.generate_var_key(*var), self.shell.get_buf())
                            .map_err(Error::StoreError)?;
                        self.shell.write_str("\r\n").map_err(Error::FormatError)?;
                    }
                    self.shell.reset();
                    self.shell.activate_promt();
                }
            }
            shell::KEY_DC4 => {}
            shell::KEY_ESC | b'[' => {
                self.shell.escape();
            }
            shell::KEY_BS | shell::KEY_DEL => {
                if self.shell.get_buf().len() == 0 {
                    self.shell
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                    return Ok(());
                }
                self.shell.pop();
                self.shell
                    .write_str(shell::DEL)
                    .map_err(Error::FormatError)?;
            }
            shell::KEY_RET => {
                return if self.shell.get_rec().is_some() {
                    self.shell.push(byte).map_err(Error::FormatError)?;
                    self.shell.push(b'\n').map_err(Error::FormatError)?;
                    self.shell.write_str(" ").map_err(Error::FormatError)
                } else {
                    let prog = str::from_utf8(self.shell.get_buf()).map_err(Error::BadInput)?;
                    self.vm.load(prog).map_err(Error::VMError)?;
                    self.shell.reset();
                    self.shell.activate_promt();
                    self.shell.write_str("\r\n").map_err(Error::FormatError)
                };
            }
            _ => {
                if self.shell.escape_active() {
                    self.shell.unescape();
                    return Ok(());
                }
                self.shell.push(byte).map_err(Error::FormatError)?;
                self.shell
                    .write_char(byte as char)
                    .map_err(Error::FormatError)?;
            }
        }
        Ok(())
    }

    fn tick(&mut self) -> Result<(), Error> {
        match self.vm.tick() {
            Ok(Some(req)) => match req {
                VMRequest::Idle => {}
                VMRequest::Reset => self.reset()?,
                VMRequest::Wire => self.update_wires(true)?,
                VMRequest::Unwire => self.update_wires(false)?,
                VMRequest::ListWires => self.list_wires()?,
                VMRequest::IO(io) => self.io_req(io)?,
                VMRequest::CallProc(proc) => self.call_proc(proc)?,
                VMRequest::FetchVar(var) => self.fetch_var(var)?,
                VMRequest::StoreVar(var, val) => self.store_var(var, val)?,
                VMRequest::TestVar(var) => self.test_var(var)?,
                VMRequest::DeleteVar(var) => self.delete_var(var)?,
            },
            Err(VMError::ProgramHalted) => {
                self.shell.idle().map_err(Error::FormatError)?;
            }
            Err(err) => return Err(Error::VMError(err)),
            _ => {}
        };
        Ok(())
    }

    fn io_req(&mut self, req: IO) -> Result<(), Error> {
        match req {
            IO::Space => self.shell.write_str(" ").map_err(Error::FormatError),
            IO::PrintStack => self.print_stack(),
            IO::Cr | IO::Nl => self.shell.write_str("\r\n").map_err(Error::FormatError),
            IO::Clear => {
                self.shell.hide_status();
                self.shell.write_str(shell::CLS).map_err(Error::FormatError)
            }
            IO::PrintTop => {
                let top = self.vm.pop().map_err(Error::VMError)?;
                self.print_value(top)
            }
            IO::Spaces => match self.vm.pop().map_err(Error::VMError)? {
                Value::Num(num) => {
                    for _ in 0..num {
                        self.shell.write_str(" ").map_err(Error::FormatError)?;
                    }
                    Ok(())
                }
                _ => Err(Error::VMError(VMError::InvalidArguments(Word::IO(
                    IO::Spaces,
                )))),
            },
            _ => write!(self.shell, "UNIMPL IO: {:?} ", req).map_err(Error::FormatError),
        }
    }

    fn call_proc(&mut self, proc: u32) -> Result<(), Error> {
        match proc {
            proc::VERSION => self.shell.print_version().map_err(Error::FormatError)?,
            proc::HELP => self.shell.print_help().map_err(Error::FormatError)?,
            proc::STATUS => self.print_status()?,
            proc::REC => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.shell.start_rec(var);
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::HARD_RESET => {
                self.store.create().map_err(Error::StoreError)?;
                self.reset()?;
            }
            proc::CAT => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.load_buf(var)?;
                    self.shell.dump_buf().map_err(Error::FormatError)?;
                    self.shell.reset();
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::EVAL => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.load_buf(var)?;
                    let prog = str::from_utf8(self.shell.get_buf()).map_err(Error::BadInput)?;
                    self.vm.load(prog).map_err(Error::VMError)?;
                    self.shell.reset();
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::DELAY => match self.vm.pop() {
                Ok(Value::Num(num)) if num > 0 => self.delay.delay_ms(num as u32),
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            _ => {
                write!(self.shell, "ERR: Unimplemented(0x{:x})\r\n", proc)
                    .map_err(Error::FormatError)?;
                self.shell.hide_status();
            }
        };
        Ok(())
    }

    fn generate_var_key(&self, var: u32) -> [u8; 4] {
        let mut key_buf = [0; 4];
        BigEndian::write_u32(&mut key_buf, var);
        key_buf
    }

    fn contains_var(&mut self, var: u32) -> Result<bool, Error> {
        self.store
            .contains_key(&self.generate_var_key(var))
            .map_err(Error::StoreError)
    }

    fn load_buf(&mut self, var: u32) -> Result<(), Error> {
        self.shell.reset();
        let key_buf = self.generate_var_key(var);
        let mut offset = 0;
        loop {
            let buf = self.shell.get_buf_mut();
            let n = self
                .store
                .load_val(&key_buf, offset as u16, &mut buf[offset..(offset + 255)])
                .map_err(Error::StoreError)?;
            offset += n;
            if n < 255 {
                break;
            }
        }
        self.shell.move_cursor(offset);
        Ok(())
    }

    fn test_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX | vars::DAC => self
                .vm
                .push(Value::Num(wire4::encode_bool(true)))
                .map_err(Error::VMError),
            var => {
                let flag = wire4::encode_bool(self.contains_var(var)?);
                self.vm.push(Value::Num(flag)).map_err(Error::VMError)
            }
        }
    }

    fn fetch_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::AUX | vars::DAC => {
                let err = VMError::InvalidArguments(Word::FetchVar);
                Err(Error::VMError(err))
            }
            vars::ADC => {
                let raw: u32 = self
                    .adc
                    .read(&mut self.adc_pin)
                    .map_err(|_| Error::AdcError)?;
                let u = raw * 5000 / 4095;
                self.vm.push(Value::Num(u as i32)).map_err(Error::VMError)
            }
            var => {
                let var = match var {
                    vars::AUX | vars::DAC => {
                        let err = VMError::InvalidArguments(Word::FetchVar);
                        Err(Error::VMError(err))
                    }
                    vars::ADC => {
                        let raw: u32 = self
                            .adc
                            .read(&mut self.adc_pin)
                            .map_err(|_| Error::AdcError)?;
                        let u = raw * 5000 / 4095;
                        Ok(Value::Num(u as i32))
                    }
                    var => {
                        let mut var_buf = [0; 12];
                        let n = self
                            .store
                            .load_val(&self.generate_var_key(var), 0, &mut var_buf)
                            .map_err(Error::StoreError)?;
                        if n == 5 && var_buf[0] == 0 {
                            let val = BigEndian::read_i32(&var_buf[1..5]);
                            Ok(Value::Num(val))
                        } else {
                            let string = str::from_utf8(&var_buf[0..n]).map_err(Error::BadInput)?;
                            let string_key =
                                self.vm.intern_string(&string).map_err(Error::VMError)?;
                            Ok(Value::Str(string_key))
                        }
                    }
                }?;
                self.vm.push(var).map_err(Error::VMError)
            }
        }
    }

    fn store_var(&mut self, var: u32, val: Value) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX => {
                let err = VMError::InvalidArguments(Word::StoreVar);
                Err(Error::VMError(err))
            }
            vars::DAC => match val {
                Value::Num(num) => {
                    let val = num * 4095 / 3300;
                    self.dac.set_value(val as u16);
                    Ok(())
                }
                _ => {
                    let err = VMError::InvalidArguments(Word::StoreVar);
                    Err(Error::VMError(err))
                }
            },
            var => match val {
                Value::Num(num) => {
                    let mut val_buf = [0; 5];
                    BigEndian::write_i32(&mut val_buf[1..5], num);
                    self.store
                        .insert(&self.generate_var_key(var), &val_buf)
                        .map_err(Error::StoreError)
                }
                Value::Str(str_key) => {
                    let val = self
                        .vm
                        .get_string(str_key)
                        .ok_or(Error::VMError(VMError::InvalidPtr))?;
                    self.store
                        .insert(&self.generate_var_key(var), val.as_ref())
                        .map_err(Error::StoreError)
                }
                _ => {
                    let err = VMError::InvalidArguments(Word::StoreVar);
                    Err(Error::VMError(err))
                }
            },
        }
    }

    fn delete_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX | vars::DAC => {
                let err = VMError::InvalidArguments(Word::DeleteVar);
                Err(Error::VMError(err))
            }
            var => self
                .store
                .remove(&self.generate_var_key(var))
                .map_err(Error::StoreError),
        }
    }

    fn list_wires(&mut self) -> Result<(), Error> {
        if let Value::Net(net) = self.vm.pop().map_err(Error::VMError)? {
            let mut buf = [0; MAX_NET_PORTS - 1];
            let wires = self
                .bb
                .wires(net, &mut buf)
                .map_err(Error::BreadboardError)?;
            for wire in &buf[0..wires] {
                self.vm.push(Value::Port(*wire)).map_err(Error::VMError)?;
            }
            self.vm
                .push(Value::Num(wires as i32))
                .map_err(Error::VMError)?;
            return Ok(());
        }
        Err(Error::VMError(VMError::InvalidArguments(Word::ListWires)))
    }

    fn update_wires(&mut self, on: bool) -> Result<(), Error> {
        match (
            self.vm.pop().map_err(Error::VMError)?,
            self.vm.pop().map_err(Error::VMError)?,
        ) {
            (Value::Net(net), Value::Num(amount)) => {
                for _ in 0..amount {
                    match self.vm.pop().map_err(Error::VMError)? {
                        Value::Port(port) => {
                            if on {
                                self.bb.wire(net, port).map_err(Error::BreadboardError)?
                            } else {
                                self.bb.unwire(net, port).map_err(Error::BreadboardError)?
                            }
                        }
                        _ => {
                            return Err(Error::VMError(VMError::InvalidArguments(Word::Wire)));
                        }
                    }
                }
                Ok(())
            }
            _ => Err(Error::VMError(VMError::InvalidArguments(Word::Wire))),
        }
    }

    fn print_stack(&mut self) -> Result<(), Error> {
        for val in self.vm.get_stack().clone() {
            self.print_value(val)?;
        }
        self.shell
            .write_str("<- Top ")
            .map_err(Error::FormatError)?;
        Ok(())
    }

    pub fn print_status(&mut self) -> Result<(), Error> {
        for net in &NETS {
            let mut buf = [0; MAX_NET_PORTS - 1];
            let wires = self
                .bb
                .wires(*net, &mut buf)
                .map_err(Error::BreadboardError)?;
            if wires > 0 {
                self.print_value(Value::Net(*net))?;
                for port in &buf[0..wires] {
                    self.print_value(Value::Port(*port))?;
                }
                self.shell.write_str("\r\n").map_err(Error::FormatError)?;
            }
        }
        Ok(())
    }

    fn print_value(&mut self, val: Value) -> Result<(), Error> {
        match val {
            Value::Var(var) => write!(self.shell, "${:x} ", var),
            Value::Num(num) => write!(self.shell, "{} ", num),
            Value::Str(key) => match self.vm.get_string(key) {
                Some(string) => write!(self.shell, "{} ", string),
                None => write!(self.shell, "*{:x} ", key),
            },
            Value::Net(net) => {
                if let Ok(net_name) = resolve_net_name(net) {
                    write!(self.shell, "{} ", net_name)
                } else {
                    write!(self.shell, "#{:x} ", net)
                }
            }
            Value::Port(port) => {
                if let Ok(port_name) = resolve_port_name(port) {
                    write!(self.shell, "{} ", port_name)
                } else {
                    write!(self.shell, "~{:x} ", port)
                }
            }
        }
        .map_err(Error::FormatError)
    }
}

mod proc {
    pub const VERSION: u32 = 0x1dc6_8700;
    pub const HELP: u32 = 0xac61_5edc;
    pub const STATUS: u32 = 0xca52_ccb5;
    pub const HARD_RESET: u32 = 0x873f_1773;
    pub const DELAY: u32 = 0x604d_5d99;
    pub const REC: u32 = 0xae87_22d4;
    pub const CAT: u32 = 0x6864_9727;
    pub const EVAL: u32 = 0xaea0_4ff1;
}

mod vars {
    pub const BOOT: u32 = 0x4fc8_01d0;
    pub const AUX: u32 = 0xb436_c496;
    pub const ADC: u32 = 0x7b63_9cfb;
    pub const DAC: u32 = 0x322d_b04f;
}
