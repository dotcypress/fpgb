use byteorder::{BigEndian, ByteOrder};
use eeprom24x::{ic, Eeprom24x, SlaveAddr};
use hal::hal::blocking::delay::DelayMs;
use hal::hal::blocking::i2c::{Write, WriteRead};

use kvs::StoreAdapter;

pub struct EepromAdapter<I2C, D> {
    delay: D,
    eeprom: Eeprom24x<I2C, ic::IC24x128>,
}

impl<I2C, D, E> EepromAdapter<I2C, D>
where
    I2C: Write<Error = E> + WriteRead<Error = E>,
{
    pub fn new(dev: I2C, delay: D) -> EepromAdapter<I2C, D> {
        EepromAdapter {
            delay,
            eeprom: Eeprom24x::new_24x128(dev, SlaveAddr::Default),
        }
    }
}

impl<I2C, D, E> StoreAdapter for EepromAdapter<I2C, D>
where
    I2C: Write<Error = E> + WriteRead<Error = E>,
    D: DelayMs<u32>,
{
    const MAGIC: [u8; 4] = *b"fpgb";
    const PAGE_SIZE: u16 = 32;
    const TOTAL_PAGES: u16 = 512;

    type Error = eeprom24x::Error<E>;

    fn read(&mut self, addr: u16, buf: &mut [u8]) -> Result<(), Self::Error> {
        let mut address: [u8; 2] = [0; 2];
        BigEndian::write_u16(&mut address, addr);
        self.eeprom.read_data(&address, buf)?;
        Ok(())
    }

    fn write(&mut self, addr: u16, data: &[u8]) -> Result<(), Self::Error> {
        let mut address: [u8; 2] = [0; 2];
        BigEndian::write_u16(&mut address, addr);
        self.eeprom.write_page(&address, &data)?;
        self.delay.delay_ms(5);
        Ok(())
    }
}
