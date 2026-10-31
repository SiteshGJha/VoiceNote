//! PCM silence trimming with phoneme padding.
//!
//! Analyzes raw 16-bit linear PCM audio frames using Root Mean Square (RMS) energy,
//! identifies speech boundaries, and applies configurable padding (default 200 ms)
//! to preserve edge phonemes before and after speech.

/// Default sample rate for VoiceNote audio pipeline (16 kHz).
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;

/// Default frame duration for VAD and energy calculations (30 ms).
pub const DEFAULT_FRAME_MS: u32 = 30;

/// Default phoneme padding duration (200 ms).
pub const DEFAULT_PADDING_MS: u32 = 200;

/// Default normalized speech detection threshold.
pub const DEFAULT_RMS_THRESHOLD: f32 = 0.04;

/// Result of a silence trimming operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrimResult {
    /// The trimmed PCM samples, including phoneme padding.
    pub trimmed_pcm: Vec<i16>,
    /// Whether any speech frames exceeding the threshold were detected.
    pub has_speech: bool,
    /// The start sample index in the original PCM buffer.
    pub speech_start_sample: usize,
    /// The end sample index (exclusive) in the original PCM buffer.
    pub speech_end_sample: usize,
}

/// Computes the normalized RMS energy [0.0, 1.0] for a slice of 16-bit PCM samples.
#[inline]
fn compute_frame_rms(frame: &[i16]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let mut sum_sq: f64 = 0.0;
    for &sample in frame {
        let s = sample as f64;
        sum_sq += s * s;
    }
    let mean_sq = sum_sq / frame.len() as f64;
    (mean_sq.sqrt() / 32768.0) as f32
}

/// Trims leading and trailing silence from 16-bit PCM audio sampled at the default 16 kHz rate.
///
/// # Arguments
/// * `pcm` - Slice of raw 16-bit signed PCM samples.
/// * `padding_ms` - Phoneme padding duration in milliseconds to preserve around speech.
/// * `frame_ms` - Frame duration in milliseconds for energy analysis (e.g. 30 ms).
/// * `rms_threshold` - Normalized RMS energy threshold (e.g. 0.04).
pub fn trim_silence(pcm: &[i16], padding_ms: u32, frame_ms: u32, rms_threshold: f32) -> TrimResult {
    trim_silence_with_rate(
        pcm,
        padding_ms,
        frame_ms,
        rms_threshold,
        DEFAULT_SAMPLE_RATE,
    )
}

/// Trims leading and trailing silence from 16-bit PCM audio with an explicit sample rate.
///
/// Divides the audio into frames of `frame_ms` duration, computes RMS energy for each
/// frame, locates the first and last speech frames exceeding `rms_threshold`, and clamps
/// `padding_ms` of silence around the detected boundaries.
pub fn trim_silence_with_rate(
    pcm: &[i16],
    padding_ms: u32,
    frame_ms: u32,
    rms_threshold: f32,
    sample_rate: u32,
) -> TrimResult {
    if pcm.is_empty() || frame_ms == 0 || sample_rate == 0 {
        return TrimResult {
            trimmed_pcm: Vec::new(),
            has_speech: false,
            speech_start_sample: 0,
            speech_end_sample: 0,
        };
    }

    let frame_size = ((sample_rate as u64 * frame_ms as u64) / 1000) as usize;
    if frame_size == 0 {
        return TrimResult {
            trimmed_pcm: Vec::new(),
            has_speech: false,
            speech_start_sample: 0,
            speech_end_sample: 0,
        };
    }

    let padding_samples = ((sample_rate as u64 * padding_ms as u64) / 1000) as usize;
    let threshold = if rms_threshold.is_finite() && rms_threshold >= 0.0 {
        rms_threshold
    } else {
        DEFAULT_RMS_THRESHOLD
    };

    let mut first_speech_frame: Option<usize> = None;
    let mut last_speech_frame: Option<usize> = None;

    for (frame_idx, chunk) in pcm.chunks(frame_size).enumerate() {
        let rms = compute_frame_rms(chunk);
        if rms >= threshold {
            if first_speech_frame.is_none() {
                first_speech_frame = Some(frame_idx);
            }
            last_speech_frame = Some(frame_idx);
        }
    }

    let (first_idx, last_idx) = match (first_speech_frame, last_speech_frame) {
        (Some(first), Some(last)) => (first, last),
        _ => {
            return TrimResult {
                trimmed_pcm: Vec::new(),
                has_speech: false,
                speech_start_sample: 0,
                speech_end_sample: 0,
            };
        }
    };

    let raw_speech_start = first_idx * frame_size;
    let raw_speech_end = ((last_idx + 1) * frame_size).min(pcm.len());

    let start_sample = raw_speech_start.saturating_sub(padding_samples);
    let end_sample = (raw_speech_end + padding_samples).min(pcm.len());

    TrimResult {
        trimmed_pcm: pcm[start_sample..end_sample].to_vec(),
        has_speech: true,
        speech_start_sample: start_sample,
        speech_end_sample: end_sample,
    }
}
