use hal::analog::adc;
use hal::analog::dac;
use hal::delay;
use hal::gpio::gpioa::*;
use hal::gpio::gpiob::*;
use hal::gpio::gpioc::*;
use hal::gpio::*;
use hal::i2c;
use hal::serial;
use hal::stm32;
use hal::time::Hertz;
use hal::timer;

pub const MAX_NETS: usize = 16;
pub const MAX_NET_PORTS: usize = 8;
pub const UI_FREQ: Hertz = Hertz(1);
pub const ANIMATION_FREQ: Hertz = Hertz(30);

pub type Serial = serial::Serial<stm32::USART2>;
pub type Adc = adc::Adc;
pub type AdcPin = PA5<hal::gpio::Analog>;
pub type Dac = dac::Channel1;
pub type UITimer = timer::Timer<stm32::TIM16>;
pub type LedTimer = timer::Timer<stm32::TIM17>;
pub type I2CBus = i2c::I2c<stm32::I2C2, PA12<Output<OpenDrain>>, PA11<Output<OpenDrain>>>;
pub type VmDelay = delay::Delay<stm32::TIM15>;
pub type EepromAdapter = crate::eeprom::EepromAdapter<I2CBus, delay::Delay<stm32::TIM3>>;
pub type EepromStore = kvs::KVStore<EepromAdapter>;
pub type SwitchMatrix = crate::matrix::SwitchMatrix<
    delay::Delay<stm32::TIM2>,
    PB9<Output<PushPull>>,
    PB7<Output<PushPull>>,
    PB8<Output<PushPull>>,
    PA1<Output<PushPull>>,
    PA0<Output<PushPull>>,
    PB5<Output<PushPull>>,
    PB2<Output<PushPull>>,
    PB0<Output<PushPull>>,
    PB1<Output<PushPull>>,
    PA10<Output<PushPull>>,
    PA6<Output<PushPull>>,
    PA7<Output<PushPull>>,
    PA9<Output<PushPull>>,
    PC6<Output<PushPull>>,
    PA15<Output<PushPull>>,
>;
