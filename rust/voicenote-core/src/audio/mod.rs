pub mod buffer;
pub mod silence_trim;
pub mod wav;

pub use buffer::AudioBuffer;
pub use silence_trim::{trim_silence, trim_silence_with_rate, TrimResult};
pub use wav::wrap_pcm_with_wav_header;
