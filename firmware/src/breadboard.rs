use crate::config::*;

#[derive(Debug)]
pub enum Error {
    MatrixError,
    UnknownNet,
    UnknownPort,
    BusFull,
}

pub struct Breadboard {
    matrix: SwitchMatrix,
    nets: [Net; MAX_NETS],
}

impl Breadboard {
    pub fn new(matrix: SwitchMatrix) -> Self {
        Breadboard {
            matrix,
            nets: [Net::default(); MAX_NETS],
        }
    }

    pub fn reset(&mut self) -> Result<(), Error> {
        self.nets = [Net::default(); MAX_NETS];
        self.matrix.reset().map_err(|_| Error::MatrixError)
    }

    pub fn wire(&mut self, net: u32, port: u32) -> Result<(), Error> {
        let net_idx = resolve_net_idx(net)?;
        self.nets[net_idx].connect(port)?;
        let (chip_idx, port_idx) = resolve_port(port)?;
        self.matrix
            .connect(chip_idx, net_idx, port_idx)
            .map_err(|_| Error::MatrixError)?;
        Ok(())
    }

    pub fn unwire(&mut self, net: u32, port: u32) -> Result<(), Error> {
        let net_idx = resolve_net_idx(net)?;
        self.nets[net_idx].disconnect(port);
        let (chip_idx, port_idx) = resolve_port(port)?;
        self.matrix
            .disconnect(chip_idx, net_idx, port_idx)
            .map_err(|_| Error::MatrixError)?;
        Ok(())
    }

    pub fn wires(&self, net: u32, buf: &mut [u32]) -> Result<usize, Error> {
        let net_idx = resolve_net_idx(net)?;
        Ok(self.nets[net_idx].connections(buf))
    }
}

pub fn resolve_net_name(net: u32) -> Result<&'static str, Error> {
    let idx = resolve_net_idx(net)?;
    Ok(match idx {
        0 => "#1",
        1 => "#2",
        2 => "#3",
        3 => "#4",
        4 => "#5",
        5 => "#6",
        6 => "#7",
        7 => "#8",
        8 => "#9",
        9 => "#10",
        10 => "#11",
        11 => "#12",
        12 => "#13",
        13 => "#14",
        14 => "#15",
        15 => "#16",
        _ => return Err(Error::UnknownNet),
    })
}

pub fn resolve_port_name(net: u32) -> Result<&'static str, Error> {
    Ok(match net {
        ports::V5 => "~5V",
        ports::V3 => "~3V",
        ports::GND => "~gnd",
        ports::AUX => "~aux",
        ports::DAC => "~dac",
        ports::ADC => "~adc",
        ports::A1 => "~a1",
        ports::B1 => "~b1",
        ports::C1 => "~c1",
        ports::D1 => "~d1",
        ports::E1 => "~e1",
        ports::F1 => "~f1",
        ports::G1 => "~g1",
        ports::H1 => "~h1",
        ports::I1 => "~i1",
        ports::J1 => "~j1",
        ports::A2 => "~a2",
        ports::B2 => "~b2",
        ports::C2 => "~c2",
        ports::D2 => "~d2",
        ports::E2 => "~e2",
        ports::F2 => "~f2",
        ports::G2 => "~g2",
        ports::H2 => "~h2",
        ports::I2 => "~i2",
        ports::J2 => "~j2",
        ports::A3 => "~a3",
        ports::B3 => "~b3",
        ports::C3 => "~c3",
        ports::D3 => "~d3",
        ports::E3 => "~e3",
        ports::F3 => "~f3",
        ports::G3 => "~g3",
        ports::H3 => "~h3",
        ports::I3 => "~i3",
        ports::J3 => "~j3",
        ports::A4 => "~a4",
        ports::B4 => "~b4",
        ports::C4 => "~c4",
        ports::D4 => "~d4",
        ports::E4 => "~e4",
        ports::F4 => "~f4",
        ports::G4 => "~g4",
        ports::H4 => "~h4",
        ports::I4 => "~i4",
        ports::J4 => "~j4",
        ports::A5 => "~a5",
        ports::B5 => "~b5",
        ports::C5 => "~c5",
        ports::D5 => "~d5",
        ports::E5 => "~e5",
        ports::F5 => "~f5",
        ports::G5 => "~g5",
        ports::H5 => "~h5",
        ports::I5 => "~i5",
        ports::J5 => "~j5",
        ports::A6 => "~a6",
        ports::B6 => "~b6",
        ports::C6 => "~c6",
        ports::D6 => "~d6",
        ports::E6 => "~e6",
        ports::F6 => "~f6",
        ports::G6 => "~g6",
        ports::H6 => "~h6",
        ports::I6 => "~i6",
        ports::J6 => "~j6",
        ports::A7 => "~a7",
        ports::B7 => "~b7",
        ports::C7 => "~c7",
        ports::D7 => "~d7",
        ports::E7 => "~e7",
        ports::F7 => "~f7",
        ports::G7 => "~g7",
        ports::H7 => "~h7",
        ports::I7 => "~i7",
        ports::J7 => "~j7",
        ports::A8 => "~a8",
        ports::B8 => "~b8",
        ports::C8 => "~c8",
        ports::D8 => "~d8",
        ports::E8 => "~e8",
        ports::F8 => "~f8",
        ports::G8 => "~g8",
        ports::H8 => "~h8",
        ports::I8 => "~i8",
        ports::J8 => "~j8",
        ports::A9 => "~a9",
        ports::B9 => "~b9",
        ports::C9 => "~c9",
        ports::D9 => "~d9",
        ports::E9 => "~e9",
        ports::F9 => "~f9",
        ports::G9 => "~g9",
        ports::H9 => "~h9",
        ports::I9 => "~i9",
        ports::J9 => "~j9",
        ports::A10 => "~a10",
        ports::B10 => "~b10",
        ports::C10 => "~c10",
        ports::D10 => "~d10",
        ports::E10 => "~e10",
        ports::F10 => "~f10",
        ports::G10 => "~g10",
        ports::H10 => "~h10",
        ports::I10 => "~i10",
        ports::J10 => "~j10",
        ports::A11 => "~a11",
        ports::B11 => "~b11",
        ports::C11 => "~c11",
        ports::D11 => "~d11",
        ports::E11 => "~e11",
        ports::F11 => "~f11",
        ports::G11 => "~g11",
        ports::H11 => "~h11",
        ports::I11 => "~i11",
        ports::J11 => "~j11",
        ports::A12 => "~a12",
        ports::B12 => "~b12",
        ports::C12 => "~c12",
        ports::D12 => "~d12",
        ports::E12 => "~e12",
        ports::F12 => "~f12",
        ports::G12 => "~g12",
        ports::H12 => "~h12",
        ports::I12 => "~i12",
        ports::J12 => "~j12",
        ports::A13 => "~a13",
        ports::B13 => "~b13",
        ports::C13 => "~c13",
        ports::D13 => "~d13",
        ports::E13 => "~e13",
        ports::F13 => "~f13",
        ports::G13 => "~g13",
        ports::H13 => "~h13",
        ports::I13 => "~i13",
        ports::J13 => "~j13",
        ports::A14 => "~a14",
        ports::B14 => "~b14",
        ports::C14 => "~c14",
        ports::D14 => "~d14",
        ports::E14 => "~e14",
        ports::F14 => "~f14",
        ports::G14 => "~g14",
        ports::H14 => "~h14",
        ports::I14 => "~i14",
        ports::J14 => "~j14",
        ports::A15 => "~a15",
        ports::B15 => "~b15",
        ports::C15 => "~c15",
        ports::D15 => "~d15",
        ports::E15 => "~e15",
        ports::F15 => "~f15",
        ports::G15 => "~g15",
        ports::H15 => "~h15",
        ports::I15 => "~i15",
        ports::J15 => "~j15",
        ports::A16 => "~a16",
        ports::B16 => "~b16",
        ports::C16 => "~c16",
        ports::D16 => "~d16",
        ports::E16 => "~e16",
        ports::F16 => "~f16",
        ports::G16 => "~g16",
        ports::H16 => "~h16",
        ports::I16 => "~i16",
        ports::J16 => "~j16",
        ports::A17 => "~a17",
        ports::B17 => "~b17",
        ports::C17 => "~c17",
        ports::D17 => "~d17",
        ports::E17 => "~e17",
        ports::F17 => "~f17",
        ports::G17 => "~g17",
        ports::H17 => "~h17",
        ports::I17 => "~i17",
        ports::J17 => "~j17",
        _ => return Err(Error::UnknownPort),
    })
}

fn resolve_port(port: u32) -> Result<(usize, usize), Error> {
    Ok(match port {
        ports::GND => (4, 6),
        ports::V5 => (4, 0),
        ports::V3 => (4, 1),
        ports::AUX => (4, 7),
        ports::DAC => (4, 4),
        ports::ADC => (4, 5),
        ports::A1 | ports::B1 | ports::C1 | ports::D1 | ports::E1 => (2, 6),
        ports::F1 | ports::G1 | ports::H1 | ports::I1 | ports::J1 => (4, 2),
        ports::A2 | ports::B2 | ports::C2 | ports::D2 | ports::E2 => (0, 5),
        ports::F2 | ports::G2 | ports::H2 | ports::I2 | ports::J2 => (4, 3),
        ports::A3 | ports::B3 | ports::C3 | ports::D3 | ports::E3 => (0, 4),
        ports::F3 | ports::G3 | ports::H3 | ports::I3 | ports::J3 => (2, 4),
        ports::A4 | ports::B4 | ports::C4 | ports::D4 | ports::E4 => (0, 6),
        ports::F4 | ports::G4 | ports::H4 | ports::I4 | ports::J4 => (2, 5),
        ports::A5 | ports::B5 | ports::C5 | ports::D5 | ports::E5 => (0, 7),
        ports::F5 | ports::G5 | ports::H5 | ports::I5 | ports::J5 => (2, 7),
        ports::A6 | ports::B6 | ports::C6 | ports::D6 | ports::E6 => (0, 0),
        ports::F6 | ports::G6 | ports::H6 | ports::I6 | ports::J6 => (2, 0),
        ports::A7 | ports::B7 | ports::C7 | ports::D7 | ports::E7 => (0, 3),
        ports::F7 | ports::G7 | ports::H7 | ports::I7 | ports::J7 => (2, 1),
        ports::A8 | ports::B8 | ports::C8 | ports::D8 | ports::E8 => (0, 1),
        ports::F8 | ports::G8 | ports::H8 | ports::I8 | ports::J8 => (2, 2),
        ports::A9 | ports::B9 | ports::C9 | ports::D9 | ports::E9 => (0, 2),
        ports::F9 | ports::G9 | ports::H9 | ports::I9 | ports::J9 => (2, 3),
        ports::A10 | ports::B10 | ports::C10 | ports::D10 | ports::E10 => (1, 5),
        ports::F10 | ports::G10 | ports::H10 | ports::I10 | ports::J10 => (3, 6),
        ports::A11 | ports::B11 | ports::C11 | ports::D11 | ports::E11 => (1, 4),
        ports::F11 | ports::G11 | ports::H11 | ports::I11 | ports::J11 => (3, 5),
        ports::A12 | ports::B12 | ports::C12 | ports::D12 | ports::E12 => (1, 6),
        ports::F12 | ports::G12 | ports::H12 | ports::I12 | ports::J12 => (3, 4),
        ports::A13 | ports::B13 | ports::C13 | ports::D13 | ports::E13 => (1, 7),
        ports::F13 | ports::G13 | ports::H13 | ports::I13 | ports::J13 => (3, 7),
        ports::A14 | ports::B14 | ports::C14 | ports::D14 | ports::E14 => (1, 3),
        ports::F14 | ports::G14 | ports::H14 | ports::I14 | ports::J14 => (3, 0),
        ports::A15 | ports::B15 | ports::C15 | ports::D15 | ports::E15 => (1, 0),
        ports::F15 | ports::G15 | ports::H15 | ports::I15 | ports::J15 => (3, 1),
        ports::A16 | ports::B16 | ports::C16 | ports::D16 | ports::E16 => (1, 1),
        ports::F16 | ports::G16 | ports::H16 | ports::I16 | ports::J16 => (3, 2),
        ports::A17 | ports::B17 | ports::C17 | ports::D17 | ports::E17 => (1, 2),
        ports::F17 | ports::G17 | ports::H17 | ports::I17 | ports::J17 => (3, 3),
        _ => return Err(Error::UnknownPort),
    })
}

fn resolve_net_idx(net: u32) -> Result<usize, Error> {
    NETS.iter().position(|n| *n == net).ok_or(Error::UnknownNet)
}

#[derive(Default, Debug, Copy, Clone)]
struct Net {
    ports: [u32; MAX_NET_PORTS - 1],
    mask: u8,
}

impl Net {
    fn connections(&self, buf: &mut [u32]) -> usize {
        let mut len = 0;
        for idx in 0..MAX_NET_PORTS {
            let mask = 1 << idx;
            if self.mask & mask == mask {
                buf[len] = self.ports[idx];
                len += 1;
            }
        }
        len
    }

    fn connect(&mut self, port: u32) -> Result<(), Error> {
        self.disconnect(port);
        if self.mask == 0x_ff {
            return Err(Error::BusFull);
        }
        for idx in 0..MAX_NET_PORTS {
            let mask = 1 << idx;
            if self.mask & mask == 0 {
                self.ports[idx] = port;
                self.mask |= mask;
                break;
            }
        }
        Ok(())
    }

    fn disconnect(&mut self, port: u32) {
        if let Some(idx) = self.ports.iter().position(|p| *p == port) {
            self.mask &= !(1 << idx);
        }
    }
}

pub const NETS: [u32; MAX_NETS] = [
    nets::BUS1,
    nets::BUS2,
    nets::BUS3,
    nets::BUS4,
    nets::BUS5,
    nets::BUS6,
    nets::BUS7,
    nets::BUS8,
    nets::BUS9,
    nets::BUS10,
    nets::BUS11,
    nets::BUS12,
    nets::BUS13,
    nets::BUS14,
    nets::BUS15,
    nets::BUS16,
];

pub mod nets {
    pub const BUS1: u32 = 0xd6bf_1b1d;
    pub const BUS2: u32 = 0xf1d_7942;
    pub const BUS3: u32 = 0x8d7d_10c7;
    pub const BUS4: u32 = 0x98a0_4bf9;
    pub const BUS5: u32 = 0xbfe7_1c0b;
    pub const BUS6: u32 = 0xf30_e1c8;
    pub const BUS7: u32 = 0x5982_7dd8;
    pub const BUS8: u32 = 0x5aa5_c930;
    pub const BUS9: u32 = 0xfe7a_1f38;
    pub const BUS10: u32 = 0x6ffb_3083;
    pub const BUS11: u32 = 0x6493_209f;
    pub const BUS12: u32 = 0xa171_4824;
    pub const BUS13: u32 = 0x6b60_ef52;
    pub const BUS14: u32 = 0x24fd_0d05;
    pub const BUS15: u32 = 0xab12_4153;
    pub const BUS16: u32 = 0x7ed5_a683;
}

pub mod ports {
    pub const GND: u32 = 0x3236_427a;
    pub const V5: u32 = 0x5167_421d;
    pub const V3: u32 = 0xe914_00d5;
    pub const ADC: u32 = 0x66d4_cf0a;
    pub const DAC: u32 = 0x9e6_7a00;
    pub const AUX: u32 = 0x3884_57c6;
    pub const A1: u32 = 0xe0bb_39b9;
    pub const A2: u32 = 0x1f3d_cb7e;
    pub const A3: u32 = 0x2b8a_a63d;
    pub const A4: u32 = 0x2bdc_bc13;
    pub const A5: u32 = 0x935a_0277;
    pub const A6: u32 = 0x8162_94dd;
    pub const A7: u32 = 0x6a1b_5f4d;
    pub const A8: u32 = 0x5cdb_a58b;
    pub const A9: u32 = 0xadb_7924;
    pub const A10: u32 = 0x1f3b_7654;
    pub const A11: u32 = 0x900_a44b;
    pub const A12: u32 = 0x5e68_fe9b;
    pub const A13: u32 = 0x216_d162;
    pub const A14: u32 = 0x81c7_4473;
    pub const A15: u32 = 0x4d3_184a;
    pub const A16: u32 = 0xae_bf37;
    pub const A17: u32 = 0x239_2714;
    pub const B1: u32 = 0x41d9_a6b3;
    pub const B2: u32 = 0x3e2f_a261;
    pub const B3: u32 = 0x41b5_9b61;
    pub const B4: u32 = 0x3eb8_d1a3;
    pub const B5: u32 = 0x7f6d_f22c;
    pub const B6: u32 = 0x24c_4f3e;
    pub const B7: u32 = 0x80b6_06b5;
    pub const B8: u32 = 0x7827_e7c5;
    pub const B9: u32 = 0x60ab_596a;
    pub const B10: u32 = 0xcdf3_cacb;
    pub const B11: u32 = 0xa35f_8546;
    pub const B12: u32 = 0xdffa_0815;
    pub const B13: u32 = 0x7751_e2b5;
    pub const B14: u32 = 0xbc3e_96cc;
    pub const B15: u32 = 0x9dd5_3a1f;
    pub const B16: u32 = 0xc5c9_ce52;
    pub const B17: u32 = 0x5ed0_e8b5;
    pub const C1: u32 = 0x84d1_dc00;
    pub const C2: u32 = 0x5600_7970;
    pub const C3: u32 = 0x796d_d3a2;
    pub const C4: u32 = 0x6457_8e3f;
    pub const C5: u32 = 0x2e17_1ff6;
    pub const C6: u32 = 0xaca0_d995;
    pub const C7: u32 = 0x9630_a215;
    pub const C8: u32 = 0xf0eb_1c3e;
    pub const C9: u32 = 0xd095_77bd;
    pub const C10: u32 = 0x913c_957f;
    pub const C11: u32 = 0x6897_b28d;
    pub const C12: u32 = 0xdcb6_092f;
    pub const C13: u32 = 0xd997_0a56;
    pub const C14: u32 = 0xe7f6_8be9;
    pub const C15: u32 = 0xa569_2923;
    pub const C16: u32 = 0xc62e_553c;
    pub const C17: u32 = 0xfbb4_080c;
    pub const D1: u32 = 0xc97e_52f1;
    pub const D2: u32 = 0x2aa8_3d1d;
    pub const D3: u32 = 0x2cbc_2137;
    pub const D4: u32 = 0x9976_b1de;
    pub const D5: u32 = 0xea31_fe12;
    pub const D6: u32 = 0xd4fb_7730;
    pub const D7: u32 = 0x1956_e55e;
    pub const D8: u32 = 0x27f8_0338;
    pub const D9: u32 = 0xe93e_32cd;
    pub const D10: u32 = 0x917c_827b;
    pub const D11: u32 = 0xe9c0_e567;
    pub const D12: u32 = 0x2d18_064d;
    pub const D13: u32 = 0xdfe4_2f5f;
    pub const D14: u32 = 0x3890_1242;
    pub const D15: u32 = 0x6aeb_7669;
    pub const D16: u32 = 0xfa7b_2097;
    pub const D17: u32 = 0x5ffd_7c79;
    pub const E1: u32 = 0x84ab_0e24;
    pub const E2: u32 = 0xfd08_349d;
    pub const E3: u32 = 0x231b_9899;
    pub const E4: u32 = 0x8f32_405c;
    pub const E5: u32 = 0xc246_45c1;
    pub const E6: u32 = 0x427a_d79d;
    pub const E7: u32 = 0xbc1c_65b0;
    pub const E8: u32 = 0x1718_83d3;
    pub const E9: u32 = 0x8e19_0c29;
    pub const E10: u32 = 0xb8ec_64db;
    pub const E11: u32 = 0x9bc4_4d80;
    pub const E12: u32 = 0x43aa_b36a;
    pub const E13: u32 = 0x9a50_5ba3;
    pub const E14: u32 = 0xea99_fc24;
    pub const E15: u32 = 0x33b5_e2f5;
    pub const E16: u32 = 0xb006_46aa;
    pub const E17: u32 = 0x9bcf_d29c;
    pub const F1: u32 = 0xd5a4_1ff4;
    pub const F2: u32 = 0xfe3a_99ec;
    pub const F3: u32 = 0x4be_ad12;
    pub const F4: u32 = 0xc140_16d5;
    pub const F5: u32 = 0xaff4_1628;
    pub const F6: u32 = 0x2a15_8b42;
    pub const F7: u32 = 0x6331_b0a1;
    pub const F8: u32 = 0xe23_18c6;
    pub const F9: u32 = 0x624b_0a94;
    pub const F10: u32 = 0xd7ea_ac13;
    pub const F11: u32 = 0xba4b_1cb7;
    pub const F12: u32 = 0x60a8_bf6d;
    pub const F13: u32 = 0x68c1_dc3b;
    pub const F14: u32 = 0x627f_d6de;
    pub const F15: u32 = 0x9722_595c;
    pub const F16: u32 = 0xeb94_5c4b;
    pub const F17: u32 = 0xf7c7_a8b9;
    pub const G1: u32 = 0x408a_7d01;
    pub const G2: u32 = 0x7992_e8e1;
    pub const G3: u32 = 0x7619_f74d;
    pub const G4: u32 = 0x6ccb_62e6;
    pub const G5: u32 = 0x439e_fbfa;
    pub const G6: u32 = 0xf10f_75c1;
    pub const G7: u32 = 0x293d_5582;
    pub const G8: u32 = 0x3dd7_552d;
    pub const G9: u32 = 0xdfdd_8d92;
    pub const G10: u32 = 0x1fcc_f836;
    pub const G11: u32 = 0xd2e7_60c4;
    pub const G12: u32 = 0x193_ad7c;
    pub const G13: u32 = 0xec47_4b74;
    pub const G14: u32 = 0x3b24_3321;
    pub const G15: u32 = 0xcd8b_f38e;
    pub const G16: u32 = 0x7d0_28f2;
    pub const G17: u32 = 0x31d0_475f;
    pub const H1: u32 = 0x8eaf_6a4f;
    pub const H2: u32 = 0xc48_673c;
    pub const H3: u32 = 0x3414_6038;
    pub const H4: u32 = 0xd27a_2d7a;
    pub const H5: u32 = 0x770d_2245;
    pub const H6: u32 = 0x6dcd_4c4c;
    pub const H7: u32 = 0xb8e6_319b;
    pub const H8: u32 = 0xc2e8_c65e;
    pub const H9: u32 = 0xf766_b5ab;
    pub const H10: u32 = 0xf9d3_3945;
    pub const H11: u32 = 0x3e7b_8d7e;
    pub const H12: u32 = 0x840b_817d;
    pub const H13: u32 = 0x4b62_56bc;
    pub const H14: u32 = 0x8f77_8869;
    pub const H15: u32 = 0x7047_307d;
    pub const H16: u32 = 0x961b_1a67;
    pub const H17: u32 = 0x5b5f_93f5;
    pub const I1: u32 = 0x6333_9c4f;
    pub const I2: u32 = 0x5ea2_226c;
    pub const I3: u32 = 0x35ca_d571;
    pub const I4: u32 = 0xc33a_bfa4;
    pub const I5: u32 = 0xfd9a_7341;
    pub const I6: u32 = 0x6cf8_a9f8;
    pub const I7: u32 = 0x144b_a411;
    pub const I8: u32 = 0xcf1_1f08;
    pub const I9: u32 = 0xfa7e_f7c7;
    pub const I10: u32 = 0xff07_d348;
    pub const I11: u32 = 0x2537_df5f;
    pub const I12: u32 = 0x8c71_3842;
    pub const I13: u32 = 0xbe1e_b24b;
    pub const I14: u32 = 0x5520_cdfb;
    pub const I15: u32 = 0x2166_d36b;
    pub const I16: u32 = 0xc48b_62e9;
    pub const I17: u32 = 0x36ee_9651;
    pub const J1: u32 = 0x3237_91ae;
    pub const J2: u32 = 0xa682_9b65;
    pub const J3: u32 = 0x1de7_c705;
    pub const J4: u32 = 0xe847_9a4e;
    pub const J5: u32 = 0xcb49_f66e;
    pub const J6: u32 = 0xcc62_ff14;
    pub const J7: u32 = 0xc25c_4a6d;
    pub const J8: u32 = 0xd1a0_4cec;
    pub const J9: u32 = 0xcad2_edb5;
    pub const J10: u32 = 0xcab6_a8f9;
    pub const J11: u32 = 0x55f3_f000;
    pub const J12: u32 = 0x1d26_8635;
    pub const J13: u32 = 0xe748_e369;
    pub const J14: u32 = 0x6dbb_c2bd;
    pub const J15: u32 = 0x3b67_3228;
    pub const J16: u32 = 0x3d51_bf26;
    pub const J17: u32 = 0xc932_9890;
}
