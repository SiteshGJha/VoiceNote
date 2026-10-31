use std::path::{Path, PathBuf};

/// Safe, ephemeral representation of audio PCM samples.
///
/// Implements RAII: any temporary audio file associated with this buffer
/// is strictly deleted when the buffer is dropped to fulfill the prime privacy directive
/// (audio ephemerality, zero disk retention).
#[derive(Debug)]
pub struct AudioBuffer {
    pcm: Vec<i16>,
    sample_rate: u32,
    temp_path: Option<PathBuf>,
}

impl Drop for AudioBuffer {
    fn drop(&mut self) {
        if let Some(ref p) = self.temp_path {
            let _ = std::fs::remove_file(p);
        }
    }
}

impl AudioBuffer {
    /// Creates a new `AudioBuffer` from raw 16-bit PCM samples with default 16 kHz sample rate.
    pub fn from_pcm(pcm: Vec<i16>, temp_path: Option<PathBuf>) -> Self {
        Self {
            pcm,
            sample_rate: 16_000,
            temp_path,
        }
    }

    /// Creates a new `AudioBuffer` with an explicit sample rate.
    pub fn from_pcm_with_rate(pcm: Vec<i16>, sample_rate: u32, temp_path: Option<PathBuf>) -> Self {
        Self {
            pcm,
            sample_rate,
            temp_path,
        }
    }

    /// Returns the number of PCM samples.
    pub fn sample_count(&self) -> usize {
        self.pcm.len()
    }

    /// Returns the sample rate in Hz.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Returns the duration of the audio in milliseconds.
    /// Safely handles zero sample rate or empty PCM without panicking.
    pub fn duration_ms(&self) -> u32 {
        if self.sample_rate == 0 || self.pcm.is_empty() {
            0
        } else {
            ((self.pcm.len() as u64 * 1000) / self.sample_rate as u64) as u32
        }
    }

    /// Returns a slice of the raw i16 PCM samples.
    pub fn as_i16_slice(&self) -> &[i16] {
        &self.pcm
    }

    /// Returns the PCM samples normalized to [-1.0, 1.0] as 32-bit floats.
    pub fn as_f32_normalized(&self) -> Vec<f32> {
        self.pcm.iter().map(|&s| s as f32 / 32768.0).collect()
    }

    /// Returns a reference to the optional temp file path.
    pub fn temp_path(&self) -> Option<&Path> {
        self.temp_path.as_deref()
    }
}
