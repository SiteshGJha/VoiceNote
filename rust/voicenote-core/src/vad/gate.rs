//! VAD Gate state machine and audio chunk evaluator.
//!
//! Tracks speech activity across audio frames using Silero VAD (or energy RMS fallback),
//! drives state transitions (`Idle` -> `Speech` -> `Silence`), and fires auto-stop when
//! silence exceeds the preset threshold after speech has started.

use crate::errors::VnError;
use super::presets::VadSensitivity;
use super::silero::SileroVad;

/// Operating state of the VAD Gate state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadState {
    /// Initial or reset state, waiting for speech.
    Idle,
    /// Active speech in progress.
    Speech,
    /// Speech has ceased, actively measuring trailing silence window.
    Silence,
}

/// Evaluation result for a processed audio frame.
#[derive(Debug, Clone, PartialEq)]
pub struct VadFrameResult {
    /// Whether this specific frame exceeds the speech threshold.
    pub is_speech: bool,
    /// Speech probability in [0.0, 1.0].
    pub probability: f32,
    /// Current state of the VAD Gate state machine after processing this frame.
    pub state: VadState,
    /// Whether auto-stop has fired.
    pub auto_stopped: bool,
}

/// Computes normalized Root Mean Square (RMS) speech probability [0.0, 1.0]
/// calibrated against the WebRTC VAD energy curves.
#[inline]
pub fn compute_rms_prob(pcm: &[i16]) -> f32 {
    if pcm.is_empty() {
        return 0.0;
    }
    let mut sum_sq: f64 = 0.0;
    for &sample in pcm {
        let s = sample as f64;
        sum_sq += s * s;
    }
    let mean_sq = sum_sq / (pcm.len() as f64);
    let rms = mean_sq.sqrt();
    ((rms / 8000.0).min(1.0)) as f32
}

/// VAD Gate state machine that tracks speech onset, auto-stop silence windows,
/// and resets recurrent LSTM state between sessions.
pub struct VadGate {
    vad: Option<SileroVad>,
    sensitivity: VadSensitivity,
    state: VadState,
    speech_detected: bool,
    auto_stop_fired: bool,
    consecutive_speech_ms: u32,
    consecutive_silence_ms: u32,
    total_processed_ms: u32,
    min_speech_ms: u32,
    buffer: Vec<i16>,
    last_prob: f32,
}

impl std::fmt::Debug for VadGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VadGate")
            .field("sensitivity", &self.sensitivity)
            .field("state", &self.state)
            .field("speech_detected", &self.speech_detected)
            .field("auto_stop_fired", &self.auto_stop_fired)
            .field("total_processed_ms", &self.total_processed_ms)
            .finish()
    }
}

impl VadGate {
    /// Default minimum speech duration required to transition from `Idle` to `Speech` (300 ms).
    pub const DEFAULT_MIN_SPEECH_MS: u32 = 300;

    /// Creates a new `VadGate` instance wrapping an existing `SileroVad` engine.
    pub fn new(vad: SileroVad, sensitivity: VadSensitivity) -> Self {
        Self {
            vad: Some(vad),
            sensitivity,
            state: VadState::Idle,
            speech_detected: false,
            auto_stop_fired: false,
            consecutive_speech_ms: 0,
            consecutive_silence_ms: 0,
            total_processed_ms: 0,
            min_speech_ms: Self::DEFAULT_MIN_SPEECH_MS,
            buffer: Vec::with_capacity(1024),
            last_prob: 0.0,
        }
    }

    /// Creates a new `VadGate` instance from in-memory ONNX model bytes.
    pub fn new_with_model(model_bytes: &[u8], sensitivity: VadSensitivity) -> Result<Self, VnError> {
        let vad = SileroVad::new(model_bytes, sensitivity)?;
        Ok(Self::new(vad, sensitivity))
    }

    /// Creates a new `VadGate` instance using the embedded Silero ONNX model.
    pub fn new_default(sensitivity: VadSensitivity) -> Result<Self, VnError> {
        let vad = SileroVad::new_default(sensitivity)?;
        Ok(Self::new(vad, sensitivity))
    }

    /// Creates a new `VadGate` instance using pure energy-based RMS evaluation (no ONNX runtime).
    pub fn new_rms(sensitivity: VadSensitivity) -> Self {
        Self {
            vad: None,
            sensitivity,
            state: VadState::Idle,
            speech_detected: false,
            auto_stop_fired: false,
            consecutive_speech_ms: 0,
            consecutive_silence_ms: 0,
            total_processed_ms: 0,
            min_speech_ms: Self::DEFAULT_MIN_SPEECH_MS,
            buffer: Vec::with_capacity(1024),
            last_prob: 0.0,
        }
    }

    /// Sets the sensitivity preset (Low, Medium, High).
    pub fn set_sensitivity(&mut self, sensitivity: VadSensitivity) {
        self.sensitivity = sensitivity;
        if let Some(ref mut vad) = self.vad {
            vad.set_sensitivity(sensitivity);
        }
    }

    /// Returns the current sensitivity preset.
    pub fn sensitivity(&self) -> VadSensitivity {
        self.sensitivity
    }

    /// Returns the current state machine state.
    pub fn state(&self) -> VadState {
        self.state
    }

    /// Returns whether any speech has been detected since initialization or last reset.
    pub fn has_detected_speech(&self) -> bool {
        self.speech_detected
    }

    /// Returns whether auto-stop has fired.
    pub fn has_auto_stopped(&self) -> bool {
        self.auto_stop_fired
    }

    /// Returns total audio duration processed in milliseconds.
    pub fn total_processed_ms(&self) -> u32 {
        self.total_processed_ms
    }

    /// Resets the state machine and recurrent LSTM states to initial idle values.
    pub fn reset(&mut self) {
        self.state = VadState::Idle;
        self.speech_detected = false;
        self.auto_stop_fired = false;
        self.consecutive_speech_ms = 0;
        self.consecutive_silence_ms = 0;
        self.total_processed_ms = 0;
        self.buffer.clear();
        self.last_prob = 0.0;
        if let Some(ref mut vad) = self.vad {
            vad.reset_state();
        }
    }

    /// Finalizes recording and returns true if speech was detected.
    pub fn finalize(&self) -> bool {
        self.speech_detected
    }

    /// Evaluates a 16-bit PCM chunk and returns speech probability in [0.0, 1.0].
    pub fn eval_chunk(&mut self, pcm: &[i16]) -> Result<f32, VnError> {
        if pcm.is_empty() {
            return Ok(0.0);
        }

        if let Some(ref mut vad) = self.vad {
            self.buffer.extend_from_slice(pcm);

            let mut evaluated = false;
            while self.buffer.len() >= SileroVad::FRAME_SIZE {
                let mut frame_512 = [0.0f32; SileroVad::FRAME_SIZE];
                for i in 0..SileroVad::FRAME_SIZE {
                    frame_512[i] = (self.buffer[i] as f32) / 32768.0;
                }
                self.buffer.drain(0..SileroVad::FRAME_SIZE);
                self.last_prob = vad.process_frame_512(&frame_512)?;
                evaluated = true;
            }

            if !evaluated {
                let mut frame_512 = [0.0f32; SileroVad::FRAME_SIZE];
                let copy_len = self.buffer.len().min(SileroVad::FRAME_SIZE);
                for i in 0..copy_len {
                    frame_512[i] = (self.buffer[i] as f32) / 32768.0;
                }
                self.last_prob = vad.process_frame_512(&frame_512)?;
            }

            Ok(self.last_prob)
        } else {
            Ok(compute_rms_prob(pcm))
        }
    }

    /// Processes an audio frame, updates counters, and advances the VAD state machine.
    pub fn process_frame(&mut self, pcm: &[i16], frame_ms: u32) -> Result<VadFrameResult, VnError> {
        let prob = self.eval_chunk(pcm)?;
        let threshold = self.sensitivity.threshold();
        let is_speech = prob >= threshold;
        let silence_window_ms = self.sensitivity.silence_window_ms();

        self.total_processed_ms += frame_ms;

        if is_speech {
            self.consecutive_speech_ms += frame_ms;
            self.consecutive_silence_ms = 0;

            if self.consecutive_speech_ms >= self.min_speech_ms && self.state != VadState::Speech {
                self.state = VadState::Speech;
                self.speech_detected = true;
            }
        } else {
            self.consecutive_silence_ms += frame_ms;
            self.consecutive_speech_ms = 0;

            if self.state == VadState::Speech {
                self.state = VadState::Silence;
            }

            if !self.auto_stop_fired
                && self.speech_detected
                && self.consecutive_silence_ms >= silence_window_ms
            {
                self.auto_stop_fired = true;
            }
        }

        Ok(VadFrameResult {
            is_speech,
            probability: prob,
            state: self.state,
            auto_stopped: self.auto_stop_fired,
        })
    }
}
