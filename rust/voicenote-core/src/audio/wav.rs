//! WAV file encoding utilities for the VoiceNote audio pipeline.
//!
//! Encodes raw 16-bit signed linear PCM mono audio into standard 44-byte
//! RIFF/WAVE formatted byte vectors compatible with Whisper ASR and standard audio decoders.

use crate::audio::silence_trim::DEFAULT_SAMPLE_RATE;

/// Standard WAV header size in bytes for linear PCM mono audio.
pub const WAV_HEADER_SIZE: usize = 44;

/// Wraps 16-bit linear PCM audio samples with a standard 44-byte RIFF/WAVE header.
///
/// Output format:
/// - Container: RIFF (little-endian)
/// - Format: WAVE
/// - Subchunk 1: "fmt " (16 bytes for PCM)
/// - Audio format: 1 (Linear PCM)
/// - Channels: 1 (Mono)
/// - Sample rate: `sample_rate` Hz (defaults to 16 kHz if 0 is passed)
/// - Byte rate: `sample_rate * 2` bytes/sec
/// - Block align: 2 bytes (1 channel * 2 bytes/sample)
/// - Bits per sample: 16
/// - Subchunk 2: "data"
/// - Subchunk 2 size: `pcm.len() * 2` bytes
///
/// # Arguments
/// * `pcm` - Slice of signed 16-bit mono PCM audio samples.
/// * `sample_rate` - Sample rate in Hz (e.g. 16000). If 0 is provided, defaults to 16000 Hz.
///
/// # Returns
/// A `Vec<u8>` containing the 44-byte WAV header followed by little-endian 16-bit PCM sample bytes.
pub fn wrap_pcm_with_wav_header(pcm: &[i16], sample_rate: u32) -> Vec<u8> {
    let rate = if sample_rate == 0 {
        DEFAULT_SAMPLE_RATE
    } else {
        sample_rate
    };

    let data_len = (pcm.len().saturating_mul(2)) as u32;
    let chunk_size = 36u32.saturating_add(data_len);
    let byte_rate = rate.saturating_mul(2);
    let block_align: u16 = 2;
    let bits_per_sample: u16 = 16;
    let channels: u16 = 1;
    let format_tag: u16 = 1; // WAVE_FORMAT_PCM
    let subchunk1_size: u32 = 16;

    let mut out = Vec::with_capacity(WAV_HEADER_SIZE + pcm.len() * 2);

    // RIFF chunk descriptor
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&chunk_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");

    // "fmt " sub-chunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&subchunk1_size.to_le_bytes());
    out.extend_from_slice(&format_tag.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());

    // "data" sub-chunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());

    // PCM samples in little-endian format
    for &sample in pcm {
        out.extend_from_slice(&sample.to_le_bytes());
    }

    out
}
