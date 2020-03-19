use core::fmt;
use core::fmt::Write;

use crate::config::*;
use crate::hal::prelude::*;

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

const PROMT: &str = "$> ";

pub struct Shell {
    serial: Serial,
    record: Option<u32>,
    connected: bool,
    buf: [u8; 1024],
    cursor: usize,
    escape: bool,
    promt: bool,
    hide_status: bool,
}

impl Shell {
    pub fn new(serial: Serial) -> Shell {
        Shell {
            serial,
            cursor: 0,
            escape: false,
            connected: false,
            hide_status: false,
            promt: false,
            record: None,
            buf: [0; 1024],
        }
    }

    pub fn reset(&mut self) {
        self.cursor = 0;
        self.record = None;
    }

    pub fn start_rec(&mut self, var: u32) {
        self.reset();
        self.promt = false;
        self.record = Some(var);
    }

    pub fn stop_rec(&mut self) {
        self.record = None;
    }

    pub fn get_rec(&self) -> &Option<u32> {
        &self.record
    }

    pub fn move_cursor(&mut self, offset: usize) {
        self.cursor += offset;
    }

    pub fn get_buf(&self) -> &[u8] {
        &self.buf[..self.cursor]
    }

    pub fn get_buf_mut(&mut self) -> &mut [u8] {
        &mut self.buf
    }

    pub fn escape(&mut self) {
        self.escape = true;
    }

    pub fn unescape(&mut self) {
        self.escape = false;
    }

    pub fn escape_active(&self) -> bool {
        self.escape
    }

    pub fn push(&mut self, byte: u8) -> Result<(), fmt::Error> {
        if self.cursor >= self.buf.len() {
            self.write_str(BELL)?;
            return Ok(());
        }
        self.buf[self.cursor] = byte;
        self.cursor += 1;
        Ok(())
    }

    pub fn pop(&mut self) {
        self.cursor -= 1;
    }

    pub fn poll(&mut self) -> Result<u8, hal::nb::Error<hal::serial::Error>> {
        self.serial.read().and_then(|b| {
            if !self.connected {
                self.connected = true;
                self.print_banner().expect("Serial port fault");
            }
            Ok(b)
        })
    }

    pub fn idle(&mut self) -> Result<(), fmt::Error> {
        if self.promt {
            self.promt = false;
            if !self.hide_status {
                self.write_str("ok\r\n")?;
            }
            self.write_str(PROMT)?;
            self.hide_status = false;
        }
        Ok(())
    }

    pub fn activate_promt(&mut self) {
        self.promt = true;
    }

    pub fn hide_status(&mut self) {
        self.hide_status = true;
    }

    pub fn dump_buf(&mut self) -> Result<(), fmt::Error> {
        for idx in 0..self.cursor {
            self.write_char(self.buf[idx] as char)?;
        }
        self.write_str("\r\n")?;
        self.hide_status();
        self.cursor = 0;
        Ok(())
    }

    pub fn print_banner(&mut self) -> fmt::Result {
        self.write_str(CLS)?;
        for line in include_str!("./data/banner.ascii").lines() {
            write!(self, "{}\r\n", line)?;
        }
        write!(
            self,
            "Firmware: v{}\r\n\r\n{}",
            env!("CARGO_PKG_VERSION"),
            PROMT,
        )?;
        Ok(())
    }

    pub fn print_version(&mut self) -> fmt::Result {
        write!(self, "{} ", env!("CARGO_PKG_VERSION"),)
    }

    pub fn print_help(&mut self) -> fmt::Result {
        write!(self, ">> help message << ")
    }
}

impl fmt::Write for Shell {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.serial.write_str(s)
    }
}
