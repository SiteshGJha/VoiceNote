#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadSensitivity {
    Low,
    Medium,
    High,
}

impl VadSensitivity {
    pub fn threshold(&self) -> f32 {
        match self {
            VadSensitivity::Low => 0.6,
            VadSensitivity::Medium => 0.5,
            VadSensitivity::High => 0.4,
        }
    }

    pub fn silence_window_ms(&self) -> u32 {
        match self {
            VadSensitivity::Low => 2000,
            VadSensitivity::Medium => 1500,
            VadSensitivity::High => 1000,
        }
    }
}
