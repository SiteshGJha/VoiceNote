use crate::errors::VnError;
use super::presets::VadSensitivity;
use tract_onnx::prelude::*;

use tract_onnx::tract_hir::infer::InferenceOp;

type VadPlan = SimplePlan<
    InferenceFact,
    Box<dyn InferenceOp>,
    Graph<InferenceFact, Box<dyn InferenceOp>>,
>;

/// Silero VAD (v4) speech activity detector running on-device via `tract-onnx`.
pub struct SileroVad {
    plan: VadPlan,
    sensitivity: VadSensitivity,
    h: Tensor,
    c: Tensor,
    sample_rate: Tensor,
}

impl std::fmt::Debug for SileroVad {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SileroVad")
            .field("sensitivity", &self.sensitivity)
            .finish_non_exhaustive()
    }
}

impl SileroVad {
    /// Number of audio samples per VAD evaluation frame (512 samples @ 16 kHz = 32 ms).
    pub const FRAME_SIZE: usize = 512;
    /// Supported sampling rate for Silero VAD v4.
    pub const SAMPLE_RATE: i64 = 16000;

    /// Creates a new `SileroVad` instance from in-memory ONNX model bytes and a sensitivity preset.
    pub fn new(model_bytes: &[u8], sensitivity: VadSensitivity) -> Result<Self, VnError> {
        if model_bytes.is_empty() {
            return Err(VnError::AsrModelMissing(
                "Silero VAD model bytes cannot be empty".to_string(),
            ));
        }

        let plan = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(model_bytes))
            .map_err(|e| VnError::Unknown(format!("Failed to parse ONNX model: {e}")))?
            .with_input_fact(
                0,
                InferenceFact::dt_shape(f32::datum_type(), &[1usize, Self::FRAME_SIZE]),
            )
            .map_err(|e| VnError::Unknown(format!("Failed to set input #0 fact: {e}")))?
            .with_input_fact(
                1,
                InferenceFact::dt_shape(i64::datum_type(), &[] as &[usize]),
            )
            .map_err(|e| VnError::Unknown(format!("Failed to set input #1 fact: {e}")))?
            .with_input_fact(
                2,
                InferenceFact::dt_shape(f32::datum_type(), &[2usize, 1, 64]),
            )
            .map_err(|e| VnError::Unknown(format!("Failed to set input #2 fact: {e}")))?
            .with_input_fact(
                3,
                InferenceFact::dt_shape(f32::datum_type(), &[2usize, 1, 64]),
            )
            .map_err(|e| VnError::Unknown(format!("Failed to set input #3 fact: {e}")))?
            .into_runnable()
            .map_err(|e| VnError::Unknown(format!("Failed to build runnable VAD plan: {e}")))?;

        let h = tract_ndarray::Array3::<f32>::zeros((2, 1, 64)).into_tensor();
        let c = tract_ndarray::Array3::<f32>::zeros((2, 1, 64)).into_tensor();
        let sample_rate = tract_ndarray::arr0(Self::SAMPLE_RATE).into_tensor();

        Ok(Self {
            plan,
            sensitivity,
            h,
            c,
            sample_rate,
        })
    }

    /// Returns the current sensitivity configuration.
    pub fn sensitivity(&self) -> VadSensitivity {
        self.sensitivity
    }

    /// Updates the sensitivity preset.
    pub fn set_sensitivity(&mut self, sensitivity: VadSensitivity) {
        self.sensitivity = sensitivity;
    }

    /// Resets recurrent LSTM states (hidden and cell) to zeros.
    pub fn reset_state(&mut self) {
        self.h = tract_ndarray::Array3::<f32>::zeros((2, 1, 64)).into_tensor();
        self.c = tract_ndarray::Array3::<f32>::zeros((2, 1, 64)).into_tensor();
    }

    /// Evaluates a 512-sample (32 ms @ 16 kHz) normalized audio frame in [-1.0, 1.0].
    /// Returns the speech probability in [0.0, 1.0].
    pub fn process_frame_512(&mut self, samples_512: &[f32]) -> Result<f32, VnError> {
        if samples_512.len() != Self::FRAME_SIZE {
            return Err(VnError::AudioRecordFailed(format!(
                "Invalid VAD frame length: expected {}, got {}",
                Self::FRAME_SIZE,
                samples_512.len()
            )));
        }

        let input_tensor =
            tract_ndarray::ArrayView2::from_shape((1, Self::FRAME_SIZE), samples_512)
                .map_err(|e| VnError::Unknown(format!("Failed to build frame array view: {e}")))?
                .to_owned()
                .into_tensor();

        let mut outputs = self
            .plan
            .run(tvec!(
                input_tensor.into(),
                self.sample_rate.clone().into(),
                self.h.clone().into(),
                self.c.clone().into(),
            ))
            .map_err(|e| VnError::Unknown(format!("VAD inference failed: {e}")))?;

        if outputs.len() < 3 {
            return Err(VnError::Unknown(format!(
                "Unexpected number of VAD outputs: expected 3, got {}",
                outputs.len()
            )));
        }

        let prob = outputs[0]
            .as_slice::<f32>()
            .map_err(|e| VnError::Unknown(format!("Failed to extract prob slice: {e}")))?
            .first()
            .copied()
            .ok_or_else(|| VnError::Unknown("Empty prob output".to_string()))?;

        self.c = outputs.pop().unwrap().into_tensor();
        self.h = outputs.pop().unwrap().into_tensor();

        Ok(prob)
    }

    /// Convenience helper that checks if `process_frame_512` returns probability >= sensitivity threshold.
    pub fn is_speech(&mut self, samples_512: &[f32]) -> Result<bool, VnError> {
        let prob = self.process_frame_512(samples_512)?;
        Ok(prob >= self.sensitivity.threshold())
    }
}
