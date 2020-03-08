use byteorder::{BigEndian, ByteOrder};
use core::fmt::Write;
use wire4::*;

use crate::breadboard::{self, Breadboard};
use crate::config::*;
use crate::hal::prelude::*;

const BANNER: &str = include_str!("./data/banner.ascii");
const SELF_TEST_PROG: &str = include_str!("./data/self_test.wire4");

#[derive(Debug)]
pub enum Error {
    VMError(VMError),
    FormatError(core::fmt::Error),
    BreadboardError(breadboard::Error),
    SerialError(hal::nb::Error<hal::serial::Error>),
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
    buf: [u8; 256],
    cursor: usize,
    escape: bool,
    connected: bool,
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
            connected: false,
            buf: [0; 256],
        }
    }

    pub fn reset(&mut self, print_banner: bool) -> Result<(), Error> {
        self.cursor = 0;
        self.vm.reset();
        self.bb.reset().map_err(Error::BreadboardError)?;
        if print_banner {
            self.print_banner()?;
        }
        Ok(())
    }

    pub fn poll_serial(&mut self) {
        loop {
            match self.serial.read() {
                Ok(byte) => match self.handle_byte(byte) {
                    Ok(true) => {
                        write!(self.serial, "ok{}", shell::PROMT).expect("Serial port fault");
                    }
                    Ok(_) => {}
                    Err(err) => write!(self.serial, "ERR: {:?}{}", err, shell::PROMT)
                        .expect("Serial port fault"),
                },
                Err(hal::nb::Error::WouldBlock) => {
                    break;
                }
                Err(err) => write!(self.serial, "ERR: {:?}{}", err, shell::PROMT)
                    .expect("Serial port fault"),
            }
        }
    }

    fn handle_byte(&mut self, byte: u8) -> Result<bool, Error> {
        if !self.connected {
            self.connected = true;
            self.print_banner()?;
            return Ok(false);
        }
        match byte {
            shell::KEY_CTRL_R => {
                self.reset(true)?;
            }
            shell::KEY_CTRL_D => {
                write!(self.serial, "{:?}", self.vm).map_err(Error::FormatError)?
            }
            shell::KEY_ESC | b'[' => {
                // TODO: filter mouse events
                self.escape = true;
            }
            shell::KEY_BS | shell::KEY_DEL => {
                if self.cursor == 0 {
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                }
                self.serial
                    .write_str(shell::DEL)
                    .map_err(Error::FormatError)?;
                self.cursor -= 1;
            }
            shell::KEY_RET => {
                self.escape = false;
                if self.cursor == 0 {
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                }
                self.serial
                    .write_str(shell::CRFL)
                    .map_err(Error::FormatError)?;
                let prog =
                    core::str::from_utf8(&self.buf[0..self.cursor]).map_err(|_| Error::BadInput)?;
                self.cursor = 0;
                self.vm.load(prog).map_err(Error::VMError)?;
                self.spin()?; //TODO: move to main
                return Ok(true);
            }
            _ => {
                if self.escape {
                    self.escape = false;
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                }
                if self.cursor >= self.buf.len() {
                    self.serial
                        .write_str(shell::BELL)
                        .map_err(Error::FormatError)?;
                }
                self.buf[self.cursor] = byte;
                self.cursor += 1;
                if self.cursor >= self.buf.len() {
                    self.cursor = 0;
                    return Err(Error::BadInput);
                }
                self.serial.write(byte).map_err(Error::SerialError)?;
            }
        }
        Ok(false)
    }

    fn spin(&mut self) -> Result<(), Error> {
        loop {
            match self.vm.spin() {
                Err(err) => return Err(Error::VMError(err)),
                Ok(req) => match req {
                    VMRequest::Idle => return Ok(()),
                    VMRequest::Reset => self.reset(false)?,
                    VMRequest::Wire => self.update_wires(true)?,
                    VMRequest::Unwire => self.update_wires(false)?,
                    VMRequest::ListWires => self.list_wires()?,
                    VMRequest::IO(io_req) => self.io(io_req)?,
                    VMRequest::CallProc(proc) => self.call_proc(proc)?,
                    VMRequest::FetchVar(var) => self.fetch_var(var)?,
                    VMRequest::StoreVar(var, val) => self.store_var(var, val)?,
                    VMRequest::TestVar(var) => self.test_var(var)?,
                    VMRequest::DeleteVar(var) => self.delete_var(var)?,
                },
            }
        }
    }

    fn self_test(&mut self) -> Result<(), Error> {
        self.reset(false)?;
        self.vm.load(&SELF_TEST_PROG).map_err(Error::VMError)?;
        self.spin()?;
        self.reset(false)
    }

    fn io(&mut self, req: IO) -> Result<(), Error> {
        match req {
            IO::Clear => self.print_str(shell::CLS),
            IO::Cr | IO::Nl => self.print_str(shell::CRFL),
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

    fn call_proc(&mut self, word: u32) -> Result<(), Error> {
        match word {
            proc::SELF_TEST => self.self_test()?,
            proc::VERSION => self.print_version()?,
            proc::HELP => self.print_help()?,
            proc::STATUS => self.print_status()?,
            proc::DELAY => match self.vm.pop() {
                Ok(Value::Num(num)) if num > 0 => {
                    self.delay.delay_ms(num as u32);
                }
                _ => {
                    let vm_err = VMError::InvalidArguments(Word::Proc(word));
                    return Err(Error::VMError(vm_err));
                }
            },
            word => {
                write!(self.serial, "UNIMPL PROC 0x{:x} ", word).map_err(Error::FormatError)?;
            }
        };
        Ok(())
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

    fn store_var(&mut self, var: u32, val: Value) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX | vars::BOOT => {
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
            var => {
                let mut key_buf = [0; 5];
                key_buf[0] = 0xff;
                BigEndian::write_u32(&mut key_buf[1..5], var);
                match val {
                    Value::Num(num) => {
                        let mut val_buf = [0; 5];
                        BigEndian::write_i32(&mut val_buf[1..5], num);
                        self.store
                            .insert(&key_buf, &val_buf)
                            .map_err(|_| Error::StoreError)
                    }
                    Value::Str(str_key) => {
                        let val = self
                            .vm
                            .get_string(str_key)
                            .ok_or(Error::VMError(VMError::InvalidPtr))?;
                        self.store
                            .insert(&key_buf, val.as_ref())
                            .map_err(|_| Error::StoreError)
                    }
                    _ => {
                        let err = VMError::InvalidArguments(Word::StoreVar);
                        Err(Error::VMError(err))
                    }
                }
            }
        }
    }

    fn test_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX | vars::DAC => self
                .vm
                .push(Value::Num(wire4::encode_bool(true)))
                .map_err(Error::VMError),
            var => {
                let mut key_buf = [0; 5];
                key_buf[0] = 0xff;
                BigEndian::write_u32(&mut key_buf[1..5], var);
                let flag = wire4::encode_bool(
                    self.store
                        .contains_key(&key_buf)
                        .map_err(|_| Error::StoreError)?,
                );
                self.vm.push(Value::Num(flag)).map_err(Error::VMError)
            }
        }
    }

    fn fetch_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::AUX | vars::DAC | vars::BOOT => {
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
                let mut key_buf = [0; 5];
                key_buf[0] = 0xff;
                let mut var_buf = [0; 16];
                BigEndian::write_u32(&mut key_buf[1..5], var);
                let n = self
                    .store
                    .load_val(&key_buf, 0, &mut var_buf)
                    .map_err(|_| Error::StoreError)?;
                if n == 5 && var_buf[0] == 0 {
                    let val = BigEndian::read_i32(&var_buf[1..5]);
                    self.vm.push(Value::Num(val)).map_err(Error::VMError)
                } else {
                    let string =
                        core::str::from_utf8(&var_buf[0..n]).map_err(|_| Error::BadInput)?;
                    let string_key = self.vm.intern_string(&string).map_err(Error::VMError)?;
                    self.vm.push(Value::Str(string_key)).map_err(Error::VMError)
                }
            }
        }
    }

    fn delete_var(&mut self, var: u32) -> Result<(), Error> {
        match var {
            vars::ADC | vars::AUX | vars::DAC | vars::BOOT => {
                let err = VMError::InvalidArguments(Word::DeleteVar);
                Err(Error::VMError(err))
            }
            var => {
                let mut key_buf = [0; 5];
                key_buf[0] = 0xff;
                BigEndian::write_u32(&mut key_buf[1..5], var);
                self.store.remove(&key_buf).map_err(|_| Error::StoreError)
            }
        }
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
        write!(self.serial, "<- Top ").map_err(Error::FormatError)?;
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
        for line in BANNER.lines() {
            write!(self.serial, "{}{}", line, shell::CRFL).map_err(Error::FormatError)?;
        }

        write!(
            self.serial,
            "ver {}{}{}",
            env!("CARGO_PKG_VERSION"),
            shell::CRFL,
            shell::PROMT
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

pub mod proc {
    pub const HELP: u32 = 0xac61_5edc;
    pub const DELAY: u32 = 0x604d_5d99;
    pub const STATUS: u32 = 0xca52_ccb5;
    pub const VERSION: u32 = 0x1dc6_8700;
    pub const SELF_TEST: u32 = 0x3238_16a8;
}

pub mod vars {
    #[allow(dead_code)]
    pub const BOOT: u32 = 0x4fc8_01d0;
    pub const AUX: u32 = 0xb436_c496;
    pub const ADC: u32 = 0x7b63_9cfb;
    pub const DAC: u32 = 0x322d_b04f;
}

pub mod shell {
    pub const PROMT: &str = "\r\n$> ";
    pub const CLS: &str = "\x1b[H\x1b[2J";
    pub const DEL: &str = "\x08 \x08";
    pub const CRFL: &str = "\r\n";
    pub const BELL: &str = "\x07";
    pub const KEY_CTRL_D: u8 = 0x4;
    pub const KEY_CTRL_R: u8 = 0x12;
    pub const KEY_RET: u8 = 0x0d;
    pub const KEY_BS: u8 = 0x08;
    pub const KEY_DEL: u8 = 0x7f;
    pub const KEY_ESC: u8 = 0x1b;
}
