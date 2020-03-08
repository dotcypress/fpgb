use hal::hal::blocking::delay::DelayUs;
use hal::hal::digital::v2::OutputPin;

pub struct SwitchMatrix<
    D,
    RST,
    STROBE,
    DATA,
    AX0,
    AX1,
    AX2,
    AX3,
    AY0,
    AY1,
    AY2,
    CS0,
    CS1,
    CS2,
    CS3,
    CS4,
> {
    delay: D,
    reset: RST,
    strobe: STROBE,
    data: DATA,
    ax0: AX0,
    ax1: AX1,
    ax2: AX2,
    ax3: AX3,
    ay0: AY0,
    ay1: AY1,
    ay2: AY2,
    cs0: CS0,
    cs1: CS1,
    cs2: CS2,
    cs3: CS3,
    cs4: CS4,
}

impl<E, D, RST, STROBE, DATA, AX0, AX1, AX2, AX3, AY0, AY1, AY2, CS0, CS1, CS2, CS3, CS4>
    SwitchMatrix<D, RST, STROBE, DATA, AX0, AX1, AX2, AX3, AY0, AY1, AY2, CS0, CS1, CS2, CS3, CS4>
where
    D: DelayUs<u8>,
    RST: OutputPin<Error = E>,
    STROBE: OutputPin<Error = E>,
    DATA: OutputPin<Error = E>,
    AX0: OutputPin<Error = E>,
    AX1: OutputPin<Error = E>,
    AX2: OutputPin<Error = E>,
    AX3: OutputPin<Error = E>,
    AY0: OutputPin<Error = E>,
    AY1: OutputPin<Error = E>,
    AY2: OutputPin<Error = E>,
    CS0: OutputPin<Error = E>,
    CS1: OutputPin<Error = E>,
    CS2: OutputPin<Error = E>,
    CS3: OutputPin<Error = E>,
    CS4: OutputPin<Error = E>,
    E: core::fmt::Debug,
{
    #[allow(clippy::type_complexity)]
    pub fn new(
        delay: D,
        reset: RST,
        strobe: STROBE,
        data: DATA,
        x: (AX0, AX1, AX2, AX3),
        y: (AY0, AY1, AY2),
        cs: (CS0, CS1, CS2, CS3, CS4),
    ) -> SwitchMatrix<
        D,
        RST,
        STROBE,
        DATA,
        AX0,
        AX1,
        AX2,
        AX3,
        AY0,
        AY1,
        AY2,
        CS0,
        CS1,
        CS2,
        CS3,
        CS4,
    > {
        SwitchMatrix {
            delay,
            reset,
            strobe,
            data,
            ax0: x.0,
            ax1: x.1,
            ax2: x.2,
            ax3: x.3,
            ay0: y.0,
            ay1: y.1,
            ay2: y.2,
            cs0: cs.0,
            cs1: cs.1,
            cs2: cs.2,
            cs3: cs.3,
            cs4: cs.4,
        }
    }

    pub fn reset(&mut self) -> Result<(), E> {
        self.cs0.set_low()?;
        self.cs1.set_low()?;
        self.cs2.set_low()?;
        self.cs3.set_low()?;
        self.cs4.set_low()?;
        self.strobe.set_low()?;
        self.reset.set_high()?;
        self.delay.delay_us(1);
        self.reset.set_low()
    }

    pub fn connect(&mut self, chip_idx: usize, x: usize, y: usize) -> Result<(), E> {
        self.data.set_high()?;
        self.strobe(chip_idx, x, y)
    }

    pub fn disconnect(&mut self, chip_idx: usize, x: usize, y: usize) -> Result<(), E> {
        self.data.set_low()?;
        self.strobe(chip_idx, x, y)
    }

    fn strobe(&mut self, chip_idx: usize, x: usize, y: usize) -> Result<(), E> {
        assert!(chip_idx < 5 && x < 16 && y < 8);
        self.cs0.set_low()?;
        self.cs1.set_low()?;
        self.cs2.set_low()?;
        self.cs3.set_low()?;
        self.cs4.set_low()?;
        match chip_idx {
            0 => self.cs0.set_high()?,
            1 => self.cs1.set_high()?,
            2 => self.cs2.set_high()?,
            3 => self.cs3.set_high()?,
            4 => self.cs4.set_high()?,
            _ => unreachable!(),
        }
        match x {
            0 => {
                self.ax0.set_low()?;
                self.ax1.set_low()?;
                self.ax2.set_low()?;
                self.ax3.set_low()?;
            }
            1 => {
                self.ax0.set_high()?;
                self.ax1.set_low()?;
                self.ax2.set_low()?;
                self.ax3.set_low()?;
            }
            2 => {
                self.ax0.set_low()?;
                self.ax1.set_high()?;
                self.ax2.set_low()?;
                self.ax3.set_low()?;
            }
            3 => {
                self.ax0.set_high()?;
                self.ax1.set_high()?;
                self.ax2.set_low()?;
                self.ax3.set_low()?;
            }
            4 => {
                self.ax0.set_low()?;
                self.ax1.set_low()?;
                self.ax2.set_high()?;
                self.ax3.set_low()?;
            }
            5 => {
                self.ax0.set_high()?;
                self.ax1.set_low()?;
                self.ax2.set_high()?;
                self.ax3.set_low()?;
            }
            6 => {
                self.ax0.set_low()?;
                self.ax1.set_low()?;
                self.ax2.set_low()?;
                self.ax3.set_high()?;
            }
            7 => {
                self.ax0.set_high()?;
                self.ax1.set_low()?;
                self.ax2.set_low()?;
                self.ax3.set_high()?;
            }
            8 => {
                self.ax0.set_low()?;
                self.ax1.set_high()?;
                self.ax2.set_low()?;
                self.ax3.set_high()?;
            }
            9 => {
                self.ax0.set_high()?;
                self.ax1.set_high()?;
                self.ax2.set_low()?;
                self.ax3.set_high()?;
            }
            10 => {
                self.ax0.set_low()?;
                self.ax1.set_low()?;
                self.ax2.set_high()?;
                self.ax3.set_high()?;
            }
            11 => {
                self.ax0.set_high()?;
                self.ax1.set_low()?;
                self.ax2.set_high()?;
                self.ax3.set_high()?;
            }
            12 => {
                self.ax0.set_low()?;
                self.ax1.set_high()?;
                self.ax2.set_high()?;
                self.ax3.set_low()?;
            }
            13 => {
                self.ax0.set_high()?;
                self.ax1.set_high()?;
                self.ax2.set_high()?;
                self.ax3.set_low()?;
            }
            14 => {
                self.ax0.set_low()?;
                self.ax1.set_high()?;
                self.ax2.set_high()?;
                self.ax3.set_high()?;
            }
            15 => {
                self.ax0.set_high()?;
                self.ax1.set_high()?;
                self.ax2.set_high()?;
                self.ax3.set_high()?;
            }
            _ => unreachable!(),
        }
        match y {
            0 => {
                self.ay0.set_low()?;
                self.ay1.set_low()?;
                self.ay2.set_low()?;
            }
            1 => {
                self.ay0.set_high()?;
                self.ay1.set_low()?;
                self.ay2.set_low()?;
            }
            2 => {
                self.ay0.set_low()?;
                self.ay1.set_high()?;
                self.ay2.set_low()?;
            }
            3 => {
                self.ay0.set_high()?;
                self.ay1.set_high()?;
                self.ay2.set_low()?;
            }
            4 => {
                self.ay0.set_low()?;
                self.ay1.set_low()?;
                self.ay2.set_high()?;
            }
            5 => {
                self.ay0.set_high()?;
                self.ay1.set_low()?;
                self.ay2.set_high()?;
            }
            6 => {
                self.ay0.set_low()?;
                self.ay1.set_high()?;
                self.ay2.set_high()?;
            }
            7 => {
                self.ay0.set_high()?;
                self.ay1.set_high()?;
                self.ay2.set_high()?;
            }
            _ => unreachable!(),
        };

        self.delay.delay_us(1);
        self.strobe.set_high()?;
        self.delay.delay_us(1);
        self.strobe.set_low()?;
        Ok(())
    }
}
