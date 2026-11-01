//! Audio silence-based segmenter for Whisper ASR.
//!
//! Whisper processes audio within an internal 30-second window. On long
//! recordings (e.g. extended dictation or multi-speaker notes), transcribing
//! across window boundaries without alignment can drop speech or clip phonemes.
//! This module slices 16 kHz mono 16-bit PCM into <= max_segment_ms segments,
//! finding the longest silence gap within each window and cutting at the midpoint
//! of the silence to guarantee no speech is split.

pub const SAMPLES_PER_MS: usize = 16; // 16,000 Hz / 1000
pub const FRAME_MS: usize = 30;
pub const FRAME_SAMPLES: usize = FRAME_MS * SAMPLES_PER_MS; // 480 samples
pub const RMS_SILENCE_THRESHOLD: f32 = 0.04;

/// Computes normalized RMS amplitude [0.0, 1.0] from 16-bit PCM samples
/// using the 8000-peak normalization scale standard across VoiceNote.
#[inline]
pub fn compute_normalized_rms(frame: &[i16]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let mut sum_sq: f64 = 0.0;
    for &sample in frame {
        let s = sample as f64;
        sum_sq += s * s;
    }
    let mean_sq = sum_sq / frame.len() as f64;
    (mean_sq.sqrt() / 8000.0).clamp(0.0, 1.0) as f32
}

#[derive(Debug, Clone)]
struct SilenceGap {
    start_sample: usize,
    end_sample: usize,
    duration_ms: u32,
}

/// Computes segment boundary sample pairs `(start_sample, end_sample)` for 16 kHz 16-bit PCM.
///
/// # Arguments
/// * `pcm` - Slice of raw 16-bit signed PCM audio samples (16 kHz).
/// * `max_segment_ms` - Maximum segment length in milliseconds (e.g. 27,000 ms).
/// * `min_silence_ms` - Minimum duration of consecutive silent frames to consider a cut point (e.g. 200 ms).
///
/// # Returns
/// A vector of `(start_sample, end_sample)` tuples representing contiguous, non-overlapping segments.
pub fn compute_segment_boundaries(
    pcm: &[i16],
    max_segment_ms: u32,
    min_silence_ms: u32,
) -> Vec<(usize, usize)> {
    if pcm.is_empty() {
        return Vec::new();
    }

    let max_segment_samples = (max_segment_ms as usize) * SAMPLES_PER_MS;
    if max_segment_samples == 0 || pcm.len() <= max_segment_samples {
        return vec![(0, pcm.len())];
    }

    // 1. Identify all silence gaps in the audio
    let total_frames = pcm.len() / FRAME_SAMPLES;
    let mut gaps: Vec<SilenceGap> = Vec::new();
    let mut gap_start_frame: Option<usize> = None;

    for i in 0..=total_frames {
        let is_silent = if i < total_frames {
            let frame = &pcm[i * FRAME_SAMPLES..(i + 1) * FRAME_SAMPLES];
            compute_normalized_rms(frame) < RMS_SILENCE_THRESHOLD
        } else {
            false
        };

        if is_silent && gap_start_frame.is_none() {
            gap_start_frame = Some(i);
        } else if !is_silent && gap_start_frame.is_some() {
            let start_f = gap_start_frame.unwrap();
            let end_f = i;
            let gap_ms = ((end_f - start_f) * FRAME_MS) as u32;
            if gap_ms >= min_silence_ms {
                gaps.push(SilenceGap {
                    start_sample: start_f * FRAME_SAMPLES,
                    end_sample: end_f * FRAME_SAMPLES,
                    duration_ms: gap_ms,
                });
            }
            gap_start_frame = None;
        }
    }

    // 2. Iterate and carve segments
    let mut segments = Vec::new();
    let mut cursor = 0;

    while cursor < pcm.len() {
        let remaining = pcm.len() - cursor;
        if remaining <= max_segment_samples {
            segments.push((cursor, pcm.len()));
            break;
        }

        let window_end = cursor + max_segment_samples;

        // Search for the longest silence gap fully inside cursor..window_end
        let mut best_gap: Option<&SilenceGap> = None;
        for gap in &gaps {
            if gap.start_sample >= cursor && gap.end_sample <= window_end {
                match best_gap {
                    None => best_gap = Some(gap),
                    Some(prev) => {
                        // Prefer longer gap; if duration ties, prefer later gap (closer to window_end)
                        if gap.duration_ms > prev.duration_ms
                            || (gap.duration_ms == prev.duration_ms
                                && gap.start_sample > prev.start_sample)
                        {
                            best_gap = Some(gap);
                        }
                    }
                }
            }
        }

        let cut_end = if let Some(gap) = best_gap {
            gap.start_sample + (gap.end_sample - gap.start_sample) / 2
        } else {
            window_end
        };

        // Ensure forward progress
        let next_cursor = if cut_end <= cursor {
            window_end
        } else {
            cut_end
        };

        segments.push((cursor, next_cursor));
        cursor = next_cursor;
    }

    segments
}
