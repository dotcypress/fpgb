#![no_std]
#![no_main]
extern crate panic_semihosting;
extern crate rtfm;
extern crate stm32g0xx_hal as hal;
extern crate wire4;

mod breadboard;
mod config;
mod eeprom;
mod fpgb;
mod matrix;

use config::*;
use fpgb::FPGB;
use hal::analog::adc;
use hal::exti::Event;
use hal::gpio::SignalEdge;
use hal::i2c;
use hal::prelude::*;
use hal::serial;
use hal::stm32;
use rtfm::app;

#[app(device = hal::stm32, peripherals = true)]
const APP: () = {
    struct Resources {
        fpgb: FPGB,
        exti: stm32::EXTI,
        ui_timer: UITimer,
        led_timer: LedTimer,
    }

    #[init]
    fn init(ctx: init::Context) -> init::LateResources {
        let mut rcc = ctx.device.RCC.freeze(hal::rcc::Config::pll());

        let mut vm_delay = ctx.device.TIM15.delay(&mut rcc);
        let eeprom_delay = ctx.device.TIM3.delay(&mut rcc);
        let matrix_delay = ctx.device.TIM2.delay(&mut rcc);

        let mut exti = ctx.device.EXTI;
        let port_a = ctx.device.GPIOA.split(&mut rcc);
        let port_b = ctx.device.GPIOB.split(&mut rcc);
        let port_c = ctx.device.GPIOC.split(&mut rcc);

        let btn = port_a.pa8.into_pull_up_input();
        btn.listen(SignalEdge::Falling, &mut exti);
        let _blue_led_pin = port_b.pb6.into_push_pull_output();
        let adc_pin = port_a.pa5.into_analog();

        let mut ui_timer = ctx.device.TIM16.timer(&mut rcc);
        ui_timer.start(UI_FREQ);
        ui_timer.listen();

        let mut led_timer = ctx.device.TIM17.timer(&mut rcc);
        led_timer.start(ANIMATION_FREQ);
        led_timer.listen();

        let mut adc = ctx.device.ADC.constrain(&mut rcc);
        adc.set_sample_time(adc::SampleTime::T_80);
        adc.set_precision(adc::Precision::B_12);

        let mut dac = ctx.device.DAC.constrain(port_a.pa4, &mut rcc);
        dac.calibrate(&mut vm_delay);
        dac.enable();

        let i2c = ctx.device.I2C2.i2c(
            port_a.pa12.into_open_drain_output(),
            port_a.pa11.into_open_drain_output(),
            i2c::Config::new(1.mhz()),
            &mut rcc,
        );

        let mut serial = ctx
            .device
            .USART2
            .usart(port_a.pa2, port_a.pa3, serial::Config::default(), &mut rcc)
            .expect("Failed to constrain serial port");
        serial.listen(serial::Event::Rxne);

        let mut store = EepromStore::new(EepromAdapter::new(i2c, eeprom_delay));
        if store.open().is_err() {
            store.create().expect("Store fail");
        };

        let reset = port_b.pb9.into_push_pull_output();
        let strobe = port_b.pb7.into_push_pull_output();
        let data = port_b.pb8.into_push_pull_output();

        let ax0 = port_a.pa1.into_push_pull_output();
        let ax1 = port_a.pa0.into_push_pull_output();
        let ax2 = port_b.pb5.into_push_pull_output();
        let ax3 = port_b.pb2.into_push_pull_output();

        let ay0 = port_b.pb0.into_push_pull_output();
        let ay1 = port_b.pb1.into_push_pull_output();
        let ay2 = port_a.pa10.into_push_pull_output();

        let cs0 = port_a.pa6.into_push_pull_output();
        let cs1 = port_a.pa7.into_push_pull_output();
        let cs2 = port_a.pa9.into_push_pull_output();
        let cs3 = port_c.pc6.into_push_pull_output();
        let cs4 = port_a.pa15.into_push_pull_output();

        let matrix = SwitchMatrix::new(
            matrix_delay,
            reset,
            strobe,
            data,
            (ax0, ax1, ax2, ax3),
            (ay0, ay1, ay2),
            (cs0, cs1, cs2, cs3, cs4),
        );

        let mut fpgb = FPGB::new(vm_delay, serial, dac, adc, adc_pin, matrix, store);
        fpgb.reset(false).expect("Failed to reset breadboard");

        init::LateResources {
            fpgb,
            exti,
            ui_timer,
            led_timer,
        }
    }

    #[task(binds = USART2, resources = [fpgb])]
    fn serial_data(ctx: serial_data::Context) {
        // TODO: split serial data flow from VM
        ctx.resources.fpgb.poll_serial();
    }

    #[task(binds = TIM16, resources = [ui_timer])]
    fn ui_timer(ctx: ui_timer::Context) {
        ctx.resources.ui_timer.clear_irq();
    }

    #[task(binds = TIM17, resources = [led_timer])]
    fn led_timer(ctx: led_timer::Context) {
        ctx.resources.led_timer.clear_irq();
    }

    #[task(binds = EXTI4_15, resources = [exti])]
    fn btn(ctx: btn::Context) {
        ctx.resources.exti.unpend(Event::GPIO8);
    }
};
