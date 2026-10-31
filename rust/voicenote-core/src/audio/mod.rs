pub mod buffer;
pub mod silence_trim;

pub use buffer::AudioBuffer;
pub use silence_trim::{trim_silence, trim_silence_with_rate, TrimResult};
