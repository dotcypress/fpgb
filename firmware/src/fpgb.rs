use byteorder::{BigEndian, ByteOrder};
use core::fmt::Write;
use nb::block;
use wire4::*;

use crate::breadboard::{self, Breadboard};
use crate::config::*;
use crate::hal::prelude::*;

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

mod shell {
    pub const PROMT: &str = "$> ";
    pub const CLS: &str = "\x1b[H\x1b[2J";
    pub const DEL: &str = "\x08 \x08";
    pub const BELL: &str = "\x07";
    pub const KEY_BS: u8 = 0x08;
    pub const KEY_RET: u8 = 0x0d;
    pub const KEY_DEL: u8 = 0x7f;
    pub const KEY_ESC: u8 = 0x1b;
    pub const KEY_DC1: u8 = 0x11; // Ctrl+Q
    pub const KEY_DC2: u8 = 0x12; // Ctrl+R
    pub const KEY_DC3: u8 = 0x13; // Ctrl+S
    pub const KEY_DC4: u8 = 0x14; // Ctrl+T
}

#[derive(Debug)]
pub enum Error {
    VMError(VMError),
    FormatError(core::fmt::Error),
    BreadboardError(breadboard::Error),
    SerialError(hal::serial::Error),
    StoreError,
    BadInput,
    AdcError,
}

pub struct FPGB {
    delay: VmDelay,
    serial: Serial,
    adc: Adc,
    dac: Dac,
    adc_pin: AdcPin,
    vm: Wire4VM,
    store: EepromStore,
    bb: Breadboard,
    buf: [u8; 1024],
    cursor: usize,
    escape: bool,
    rec_var: Option<u32>,
    serial_connected: bool,
    promt_pending: bool,
    hide_status: bool,
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
            vm: Wire4VM::new(),
            bb: Breadboard::new(matrix),
            store,
            delay,
            dac,
            adc,
            adc_pin,
            serial,
            cursor: 0,
            escape: false,
            serial_connected: false,
            hide_status: false,
            promt_pending: false,
            rec_var: None,
            buf: [0; 1024],
        }
    }

    pub fn reset(&mut self) -> Result<(), Error> {
        self.vm.reset();
        self.bb.reset().map_err(Error::BreadboardError)?;
        self.rec_var = None;
        if self.contains_var(vars::BOOT)? {
            self.vm
                .push(Value::Var(vars::BOOT))
                .map_err(Error::VMError)?;
            if let Err(err) = self.call_proc(proc::EVAL) {
                self.vm.reset();
                self.bb.reset().map_err(Error::BreadboardError)?;
                write!(self.serial, "ERR: Boot failed {:?}\r\n", err)
                    .map_err(Error::FormatError)?;
            }
        }
        Ok(())
    }

    pub fn spin(&mut self) {
        if let Err(err) = self.tick() {
            self.hide_status = true;
            write!(self.serial, "ERR: {:?}\r\n", err).expect("Serial port fault");
        }
    }

    pub fn poll_serial(&mut self) {
        loop {
            match self.serial.read() {
                Ok(byte) => {
                    if !self.serial_connected {
                        self.serial_connected = true;
                        self.print_banner().expect("Serial port fault");
                        return;
                    }
                    if let Err(err) = self.handle_byte(byte) {
                        write!(self.serial, "ERR: {:?}\r\n", err).expect("Serial port fault");
                    }
                }
                Err(hal::nb::Error::WouldBlock) => {
                    return;
                }
                Err(err) => {
                    write!(self.serial, "ERR: Serial {:?}\r\n", err).expect("Serial port fault")
                }
            }
        }
    }

    fn handle_byte(&mut self, byte: u8) -> Result<(), Error> {
        match byte {
            shell::KEY_DC1 => {
                self.promt_pending = true;
                write!(self.serial, "{:?} ", self.vm).map_err(Error::FormatError)?
            }
            shell::KEY_DC2 => {
                self.print_banner()?;
                self.reset()?;
                self.cursor = 0;
            }
            shell::KEY_DC3 => {
                if let Some(var) = self.rec_var {
                    if self.cursor > 0 {
                        self.store
                            .insert(&self.get_var_key(var), &self.buf[..self.cursor])
                            .map_err(|_| Error::StoreError)?;
                        self.serial.write_str("\r\n").map_err(Error::FormatError)?;
                    }
                    self.cursor = 0;
                    self.hide_status = true;
                    self.promt_pending = true;
                    self.rec_var = None;
                }
            }
            shell::KEY_DC4 => {
                // Start record
            }
            shell::KEY_ESC | b'[' => {
                self.escape = true;
            }
            shell::KEY_BS | shell::KEY_DEL => {
                self.escape = false;
                if self.cursor == 0 {
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                    return Ok(());
                }
                self.serial
                    .write_str(shell::DEL)
                    .map_err(Error::FormatError)?;
                self.cursor -= 1;
            }
            shell::KEY_RET => {
                self.escape = false;
                return if self.rec_var.is_some() {
                    self.buf[self.cursor] = byte;
                    self.buf[self.cursor + 1] = b'\n';
                    self.cursor += 2;
                    self.serial.write_str(" ").map_err(Error::FormatError)
                } else {
                    let prog = core::str::from_utf8(&self.buf[..self.cursor])
                        .map_err(|_| Error::BadInput)?;
                    self.vm.load(prog).map_err(Error::VMError)?;
                    self.promt_pending = true;
                    self.cursor = 0;
                    self.serial.write_str("\r\n").map_err(Error::FormatError)
                };
            }
            _ => {
                if self.escape {
                    self.escape = false;
                    return Ok(());
                }
                if self.cursor >= self.buf.len() {
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                    return Ok(());
                }
                self.buf[self.cursor] = byte;
                self.cursor += 1;
                block!(self.serial.write(byte)).map_err(Error::SerialError)?;
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
                if self.promt_pending {
                    if !self.hide_status {
                        self.serial
                            .write_str("ok\r\n")
                            .map_err(Error::FormatError)?;
                    }
                    self.serial
                        .write_str(shell::PROMT)
                        .map_err(Error::FormatError)?;
                    self.hide_status = false;
                    self.promt_pending = false;
                }
            }
            Err(err) => return Err(Error::VMError(err)),
            _ => {}
        };
        Ok(())
    }

    fn io_req(&mut self, req: IO) -> Result<(), Error> {
        match req {
            IO::Clear => self.print_str(shell::CLS),
            IO::Cr | IO::Nl => self.print_str("\r\n"),
            IO::Space => self.print_str(" "),
            IO::PrintStack => self.print_stack(),
            IO::PrintTop => {
                let top = self.vm.pop().map_err(Error::VMError)?;
                self.print_value(top)
            }
            IO::Spaces => match self.vm.pop().map_err(Error::VMError)? {
                Value::Num(num) => {
                    for _ in 0..num {
                        self.print_str(" ")?;
                    }
                    Ok(())
                }
                _ => Err(Error::VMError(VMError::InvalidArguments(Word::IO(
                    IO::Spaces,
                )))),
            },
            _ => write!(self.serial, "UNIMPL IO: {:?} ", req).map_err(Error::FormatError),
        }
    }

    fn call_proc(&mut self, proc: u32) -> Result<(), Error> {
        match proc {
            proc::VERSION => self.print_version()?,
            proc::HELP => self.print_help()?,
            proc::STATUS => self.print_status()?,
            proc::REC => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.promt_pending = false;
                    self.cursor = 0;
                    self.rec_var = Some(var);
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::HARD_RESET => {
                self.store.create().map_err(|_| Error::StoreError)?;
                self.reset()?;
            }
            proc::CAT => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.load_var(var)?;
                    for b in &self.buf[0..self.cursor] {
                        block!(self.serial.write(*b)).map_err(Error::SerialError)?;
                    }
                    self.cursor = 0;
                    self.serial.write_str("\r\n").map_err(Error::FormatError)?;
                    self.hide_status = true;
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::EVAL => match self.vm.pop() {
                Ok(Value::Var(var)) => {
                    self.load_var(var)?;
                    let prog = core::str::from_utf8(&self.buf[..self.cursor])
                        .map_err(|_| Error::BadInput)?;
                    self.vm.load(prog).map_err(Error::VMError)?;
                    self.cursor = 0;
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            proc::DELAY => match self.vm.pop() {
                Ok(Value::Num(num)) if num > 0 => {
                    self.delay.delay_ms(num as u32);
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(proc));
                    return Err(Error::VMError(vm_err));
                }
            },
            _ => {
                write!(self.serial, "ERR: Unimplemented(0x{:x})\r\n", proc)
                    .map_err(Error::FormatError)?;
                self.hide_status = true;
            }
        };
        Ok(())
    }

    fn get_var_key(&self, var: u32) -> [u8; 4] {
        let mut key_buf = [0; 4];
        BigEndian::write_u32(&mut key_buf, var);
        key_buf
    }

    fn contains_var(&mut self, var: u32) -> Result<bool, Error> {
        self.store
            .contains_key(&self.get_var_key(var))
            .map_err(|_| Error::StoreError)
    }

    fn load_var(&mut self, var: u32) -> Result<(), Error> {
        let key_buf = self.get_var_key(var);
        self.cursor = 0;
        loop {
            let n = self
                .store
                .load_val(
                    &key_buf,
                    self.cursor as u16,
                    &mut self.buf[self.cursor..(self.cursor + 255)],
                )
                .map_err(|_| Error::StoreError)?;
            self.cursor += n;
            if n < 255 {
                break;
            }
        }
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
                            .load_val(&self.get_var_key(var), 0, &mut var_buf)
                            .map_err(|_| Error::StoreError)?;
                        if n == 5 && var_buf[0] == 0 {
                            let val = BigEndian::read_i32(&var_buf[1..5]);
                            Ok(Value::Num(val))
                        } else {
                            let string = core::str::from_utf8(&var_buf[0..n])
                                .map_err(|_| Error::BadInput)?;
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
                        .insert(&self.get_var_key(var), &val_buf)
                        .map_err(|_| Error::StoreError)
                }
                Value::Str(str_key) => {
                    let val = self
                        .vm
                        .get_string(str_key)
                        .ok_or(Error::VMError(VMError::InvalidPtr))?;
                    self.store
                        .insert(&self.get_var_key(var), val.as_ref())
                        .map_err(|_| Error::StoreError)
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
                .remove(&self.get_var_key(var))
                .map_err(|_| Error::StoreError),
        }
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

    fn print_str(&mut self, s: &str) -> Result<(), Error> {
        self.serial.write_str(s).map_err(Error::FormatError)
    }

    fn print_stack(&mut self) -> Result<(), Error> {
        for val in self.vm.get_stack() {
            match val {
                Value::Port(port) => write!(self.serial, "~{:x} ", port),
                Value::Net(net) => write!(self.serial, "#{:x} ", net),
                Value::Var(net) => write!(self.serial, "${:x} ", net),
                Value::Num(num) => write!(self.serial, "{} ", num),
                Value::Str(key) => match self.vm.get_string(*key) {
                    Some(string) => write!(self.serial, "\"{}\" ", string),
                    None => write!(self.serial, "*{:x} ", key),
                },
            }
            .map_err(Error::FormatError)?;
        }
        self.serial
            .write_str("<- Top ")
            .map_err(Error::FormatError)?;
        Ok(())
    }

    fn print_value(&mut self, val: Value) -> Result<(), Error> {
        match val {
            Value::Port(port) => write!(self.serial, "~{:x} ", port),
            Value::Net(net) => write!(self.serial, "#{:x} ", net),
            Value::Var(var) => write!(self.serial, "${:x} ", var),
            Value::Num(num) => write!(self.serial, "{} ", num),
            Value::Str(key) => match self.vm.get_string(key) {
                Some(string) => write!(self.serial, "{} ", string),
                None => write!(self.serial, "*{:x} ", key),
            },
        }
        .map_err(Error::FormatError)
    }

    fn print_banner(&mut self) -> Result<(), Error> {
        self.serial
            .write_str(shell::CLS)
            .map_err(Error::FormatError)?;
        for line in include_str!("./data/banner.ascii").lines() {
            write!(self.serial, "{}\r\n", line).map_err(Error::FormatError)?;
        }
        write!(
            self.serial,
            "Firmware: v{}\r\n\r\n{}",
            env!("CARGO_PKG_VERSION"),
            shell::PROMT,
        )
        .map_err(Error::FormatError)?;
        Ok(())
    }

    fn print_version(&mut self) -> Result<(), Error> {
        write!(self.serial, "{} ", env!("CARGO_PKG_VERSION"),).map_err(Error::FormatError)?;
        Ok(())
    }

    fn print_help(&mut self) -> Result<(), Error> {
        write!(self.serial, ">> help message << ").map_err(Error::FormatError)?;
        Ok(())
    }

    fn print_status(&mut self) -> Result<(), Error> {
        write!(self.serial, ">> status message << ").map_err(Error::FormatError)?;
        Ok(())
    }
}
