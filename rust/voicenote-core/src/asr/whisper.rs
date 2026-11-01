use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::errors::{VnError, VnErrorCode};
use crate::model_coordinator::{ActiveModel, ModelCoordinator};

#[derive(Debug, Clone)]
pub struct AsrOutput {
    pub text: String,
    pub detected_lang: String,
}

pub struct WhisperEngine {
    ctx: Option<Arc<Mutex<WhisperContext>>>,
    current_model_path: PathBuf,
}

impl std::fmt::Debug for WhisperEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperEngine")
            .field("current_model_path", &self.current_model_path)
            .field("has_context", &self.ctx.is_some())
            .finish()
    }
}

impl WhisperEngine {
    /// Loads a Whisper model from disk.
    pub async fn load(model_path: &Path) -> Result<Self, VnError> {
        if !model_path.exists() {
            return Err(VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("ASR model not found at {}", model_path.display()),
            ));
        }

        let path_str = model_path
            .to_str()
            .ok_or_else(|| VnError::new(VnErrorCode::AsrModelMissing, "Invalid model path"))?;

        let ctx = WhisperContext::new_with_params(
            path_str,
            WhisperContextParameters::default(),
        )
        .map_err(|e| {
            VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("Failed to load Whisper context: {:?}", e),
            )
        })?;

        ModelCoordinator::global()
            .request_subsystem(ActiveModel::Whisper, Some(model_path.to_string_lossy().as_ref()))
            .await?;

        Ok(Self {
            ctx: Some(Arc::new(Mutex::new(ctx))),
            current_model_path: model_path.to_path_buf(),
        })
    }

    /// Creates an uninitialized dummy engine for unit testing validation without model weights.
    pub fn dummy_for_testing() -> Self {
        Self {
            ctx: None,
            current_model_path: PathBuf::new(),
        }
    }

    /// Returns the currently loaded model path, if any.
    pub fn model_path(&self) -> &Path {
        &self.current_model_path
    }

    /// Transcribes 32-bit floating-point PCM audio (16 kHz mono) within the given timeout.
    pub async fn transcribe(
        &self,
        pcm_f32: &[f32],
        language: Option<&str>,
        initial_prompt: Option<&str>,
        timeout_ms: u64,
    ) -> Result<AsrOutput, VnError> {
        if pcm_f32.is_empty() {
            return Err(VnError::new(
                VnErrorCode::AsrEmptyOutput,
                "Cannot transcribe empty audio buffer",
            ));
        }

        let ctx_mutex = match &self.ctx {
            Some(c) => c.clone(),
            None => {
                return Err(VnError::new(
                    VnErrorCode::AsrModelMissing,
                    "No Whisper model loaded in engine",
                ));
            }
        };

        let pcm_vec = pcm_f32.to_vec();
        let lang_string = language.map(|s| s.to_string());
        let prompt_string = initial_prompt.map(|s| s.to_string());

        let inference_task = tokio::task::spawn_blocking(move || -> Result<AsrOutput, VnError> {
            let guard = ctx_mutex.blocking_lock();

            let mut state = guard.create_state().map_err(|e| {
                VnError::new(
                    VnErrorCode::Unknown,
                    format!("Failed to create Whisper state: {:?}", e),
                )
            })?;

            let mut params = FullParams::new(SamplingStrategy::default());
            params.set_print_progress(false);
            params.set_print_special(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            if let Some(ref lang) = lang_string {
                if lang == "auto" {
                    params.set_language(None);
                    params.set_detect_language(true);
                } else {
                    params.set_language(Some(lang.as_str()));
                }
            } else {
                params.set_language(None);
                params.set_detect_language(true);
            }

            if let Some(ref prompt) = prompt_string {
                params.set_initial_prompt(prompt.as_str());
            }

            state.full(params, &pcm_vec).map_err(|e| {
                VnError::new(
                    VnErrorCode::Unknown,
                    format!("Whisper inference error: {:?}", e),
                )
            })?;

            let n_segments = state.full_n_segments().map_err(|e| {
                VnError::new(
                    VnErrorCode::Unknown,
                    format!("Failed to get segment count: {:?}", e),
                )
            })?;

            let mut full_text = String::new();
            for i in 0..n_segments {
                if let Ok(seg) = state.full_get_segment_text(i) {
                    full_text.push_str(&seg);
                }
            }

            let trimmed = full_text.trim().to_string();
            if trimmed.is_empty() {
                return Err(VnError::new(
                    VnErrorCode::AsrEmptyOutput,
                    "ASR returned empty transcript",
                ));
            }

            let detected_lang_id = state.full_lang_id_from_state().unwrap_or(0);
            let detected_lang = whisper_rs::get_lang_str(detected_lang_id)
                .unwrap_or("en")
                .to_string();

            Ok(AsrOutput {
                text: trimmed,
                detected_lang,
            })
        });

        match tokio::time::timeout(Duration::from_millis(timeout_ms), inference_task).await {
            Ok(join_res) => join_res.map_err(|e| {
                VnError::new(VnErrorCode::Unknown, format!("Inference task join error: {:?}", e))
            })?,
            Err(_) => Err(VnError::new(
                VnErrorCode::AsrTimeout,
                "ASR transcription timed out",
            )),
        }
    }
}
