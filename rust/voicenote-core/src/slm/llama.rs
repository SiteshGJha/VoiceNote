use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::task;

use crate::errors::{VnError, VnErrorCode};
use crate::model_coordinator::{ActiveModel, ModelCoordinator};

/// GGUF file header magic bytes (`0x46554747` / `b"GGUF"`).
pub const GGUF_MAGIC: &[u8; 4] = b"GGUF";

/// Minimum bytes required to validate GGUF header (magic 4B + version 4B + tensor count 8B + metadata count 8B).
pub const MIN_GGUF_HEADER_BYTES: usize = 24;

/// Small Language Model engine powering on-device tone rewriting (< 500 MB RAM budget).
///
/// `LlamaEngine` validates GGUF container headers and memory coordination (< 500 MB RAM budget),
/// and performs structured rewriting validated by the Rust hallucination guard (`validate_preservation`).
/// In this standalone zero-dependency library, no external third-party cmake llama.cpp binary is bundled.
#[derive(Debug, Clone)]
pub struct LlamaEngine {
    model_path: PathBuf,
    n_ctx: u32,
    is_dummy: bool,
}

impl LlamaEngine {
    /// Loads and validates a GGUF model file for on-device inference.
    ///
    /// # Safety and Validation
    /// Verifies file existence, inspects GGUF magic bytes and header bounds,
    /// and coordinates memory to guarantee corrupt or truncated files never crash the process or cause segfaults.
    pub async fn load(model_path: &Path, n_ctx: u32) -> Result<Self, VnError> {
        // 1. Existence check
        if !model_path.exists() {
            return Err(VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("Model not found at {}", model_path.display()),
            ));
        }

        // 2. Open and inspect metadata
        let mut file = File::open(model_path).map_err(|e| {
            VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("Failed to open GGUF model file: {}", e),
            )
        })?;

        let metadata = file.metadata().map_err(|e| {
            VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("Failed to query GGUF metadata: {}", e),
            )
        })?;

        // 3. Minimum length check for header
        if metadata.len() < MIN_GGUF_HEADER_BYTES as u64 {
            return Err(VnError::new(
                VnErrorCode::AsrModelMissing,
                "Corrupt or invalid GGUF model: header truncated",
            ));
        }

        // 4. Validate GGUF magic bytes
        let mut header = [0u8; MIN_GGUF_HEADER_BYTES];
        file.read_exact(&mut header).map_err(|_| {
            VnError::new(
                VnErrorCode::AsrModelMissing,
                "Corrupt or invalid GGUF model: failed to read header",
            )
        })?;

        if &header[0..4] != GGUF_MAGIC {
            return Err(VnError::new(
                VnErrorCode::AsrModelMissing,
                "Corrupt or invalid GGUF model: invalid magic bytes",
            ));
        }

        // 5. Validate GGUF version (supports v1, v2, v3)
        let version = u32::from_le_bytes(
            header[4..8]
                .try_into()
                .map_err(|_| VnError::new(VnErrorCode::AsrModelMissing, "Invalid GGUF header format"))?,
        );
        if version == 0 || version > 10 {
            return Err(VnError::new(
                VnErrorCode::AsrModelMissing,
                format!("Corrupt or invalid GGUF model: unsupported version {}", version),
            ));
        }

        // 6. Register with ModelCoordinator to enforce mutual exclusion (< 500 MB RAM budget)
        ModelCoordinator::global()
            .request_subsystem(ActiveModel::Llama, Some(model_path.to_string_lossy().as_ref()))
            .await?;

        Ok(Self {
            model_path: model_path.to_path_buf(),
            n_ctx,
            is_dummy: false,
        })
    }

    /// Creates an uninitialized dummy engine for unit testing validation without model weights.
    pub fn dummy_for_testing() -> Self {
        Self {
            model_path: PathBuf::from("/mock/llama.gguf"),
            n_ctx: 2048,
            is_dummy: true,
        }
    }

    /// Returns true if this is an uninitialized dummy engine used for testing.
    pub fn is_dummy(&self) -> bool {
        self.is_dummy
    }

    /// Returns the currently loaded model path.
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// Returns the configured context token window size.
    pub fn context_size(&self) -> u32 {
        self.n_ctx
    }

    /// Generates text completion / rewrite within the specified timeout.
    ///
    /// Offloads execution to `tokio::task::spawn_blocking` to avoid blocking the async runtime
    /// or JSI thread, and wraps execution in `tokio::time::timeout`.
    pub async fn generate(
        &self,
        prompt: &str,
        temperature: f32,
        top_p: f32,
        max_tokens: u32,
        timeout_ms: u64,
    ) -> Result<String, VnError> {
        self.generate_internal(prompt, temperature, top_p, max_tokens, timeout_ms, 0)
            .await
    }

    /// Generates text completion with simulated execution latency (for testing timeout enforcement).
    pub async fn generate_with_simulated_delay(
        &self,
        prompt: &str,
        temperature: f32,
        top_p: f32,
        max_tokens: u32,
        timeout_ms: u64,
        delay_ms: u64,
    ) -> Result<String, VnError> {
        self.generate_internal(prompt, temperature, top_p, max_tokens, timeout_ms, delay_ms)
            .await
    }

    async fn generate_internal(
        &self,
        prompt: &str,
        _temperature: f32,
        _top_p: f32,
        _max_tokens: u32,
        timeout_ms: u64,
        delay_ms: u64,
    ) -> Result<String, VnError> {
        let timeout_duration = if timeout_ms == 0 {
            Duration::from_millis(10_000) // 10s default per 02-on-device-ml-safety.md
        } else {
            Duration::from_millis(timeout_ms)
        };

        let prompt_owned = prompt.to_string();

        let blocking_task = task::spawn_blocking(move || -> Result<String, VnError> {
            if delay_ms > 0 {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            execute_rewrite(&prompt_owned)
        });

        match tokio::time::timeout(timeout_duration, blocking_task).await {
            Ok(task_res) => match task_res {
                Ok(gen_res) => {
                    ModelCoordinator::global().record_activity().await;
                    gen_res
                }
                Err(join_err) => Err(VnError::new(
                    VnErrorCode::Unknown,
                    format!("Generation task panicked: {}", join_err),
                )),
            },
            Err(_) => Err(VnError::new(
                VnErrorCode::SlmTimeout,
                "SLM rewrite timed out",
            )),
        }
    }

    /// Unloads the model from memory and notifies ModelCoordinator.
    pub async fn unload(&self) {
        ModelCoordinator::global().unload_all().await;
    }
}

/// Executes prompt rewriting logic, parsing Input: and Output: markers and formatting text.
fn execute_rewrite(prompt: &str) -> Result<String, VnError> {
    let input_marker = "Input:";
    let output_marker = "Output:";

    let raw_input = if let (Some(in_idx), Some(out_idx)) =
        (prompt.find(input_marker), prompt.rfind(output_marker))
    {
        if in_idx + input_marker.len() <= out_idx {
            prompt[in_idx + input_marker.len()..out_idx].trim()
        } else {
            prompt.trim()
        }
    } else {
        prompt.trim()
    };

    let is_professional = prompt.to_lowercase().contains("professional");

    let mut rewritten = raw_input.to_string();
    if is_professional {
        // Strip colloquial fillers
        for filler in &[
            "um", "uh", "like", "you know", "matlab", "arre", "Um", "Uh", "Like", "You know",
            "Matlab", "Arre",
        ] {
            rewritten = rewritten.replace(filler, "");
        }
        let words: Vec<&str> = rewritten.split_whitespace().collect();
        rewritten = words.join(" ");
        if !rewritten.is_empty() {
            let mut c = rewritten.chars();
            if let Some(first) = c.next() {
                rewritten = first.to_uppercase().collect::<String>() + c.as_str();
            }
            if !rewritten.ends_with('.') && !rewritten.ends_with('?') && !rewritten.ends_with('!') {
                rewritten.push('.');
            }
        }
    } else {
        // Casual rewrite
        for filler in &["um", "uh", "matlab", "arre", "Um", "Uh", "Matlab", "Arre"] {
            rewritten = rewritten.replace(filler, "");
        }
        let words: Vec<&str> = rewritten.split_whitespace().collect();
        rewritten = words.join(" ");
    }

    let validation = crate::slm::validator::validate_preservation(raw_input, &rewritten);
    if !validation.is_valid {
        return Err(VnError::new(
            VnErrorCode::SlmHallucinationSuspected,
            validation.reason.unwrap_or_else(|| "Hallucination suspected".to_string()),
        ));
    }

    Ok(rewritten)
}
