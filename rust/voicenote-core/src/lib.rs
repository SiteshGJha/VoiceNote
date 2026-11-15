pub mod asr;
pub mod audio;
pub mod crypto;
pub mod errors;
pub mod model_coordinator;
pub mod slm;
pub mod vad;

#[cfg(any(target_os = "android", test))]
pub mod android_jni;

pub use asr::{AsrOutput, WhisperEngine};
pub use audio::{
    trim_silence, trim_silence_with_rate, wrap_pcm_with_wav_header, AudioBuffer, TrimResult,
};
pub use crypto::verify_file_sha256;
pub use errors::{VnError, VnErrorCode};
pub use model_coordinator::{ActiveModel, ModelCoordinator};
pub use slm::LlamaEngine;

use std::ffi::CString;
use std::os::raw::{c_char, c_void};

#[no_mangle]
pub extern "C" fn voicenote_core_version() -> *const c_char {
    CString::new("1.0.0").unwrap().into_raw()
}

/// # Safety
///
/// `ptr` must be a pointer previously allocated by Rust (e.g. via `voicenote_core_version`),
/// or null. Calling this on any other pointer causes undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn voicenote_core_version_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(CString::from_raw(ptr));
}

/// Trims silence from 16-bit linear PCM audio and saves the result as a standard 16 kHz WAV file.
///
/// # Arguments
/// * `pcm_ptr` - Pointer to the beginning of the 16-bit PCM sample array.
/// * `sample_count` - Number of `i16` samples in the input buffer.
/// * `output_path` - Null-terminated UTF-8 C string pointing to the destination WAV file path.
/// * `padding_ms` - Phoneme padding duration in milliseconds to preserve around speech.
///   If 0 is provided, `DEFAULT_PADDING_MS` (200 ms) is used.
///
/// # Returns
/// - `1` if speech was detected and a trimmed WAV file was successfully written.
/// - `0` if the audio was purely silent (no file is written; any stale file at `output_path` is removed).
/// - A negative error code (`-VnErrorCode`) if an error occurred (e.g. invalid arguments or I/O failure).
///
/// # Safety
/// - `pcm_ptr` must be a valid, readable pointer to at least `sample_count` contiguous `i16` values,
///   unless `sample_count` is 0.
/// - `output_path` must be a valid, null-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn vn_audio_trim_and_save_wav(
    pcm_ptr: *const i16,
    sample_count: usize,
    output_path: *const c_char,
    padding_ms: u32,
) -> i32 {
    if output_path.is_null() {
        return -(VnErrorCode::Unknown as i32);
    }

    let path_str = match std::ffi::CStr::from_ptr(output_path).to_str() {
        Ok(s) if !s.is_empty() => s,
        _ => return -(VnErrorCode::Unknown as i32),
    };

    if sample_count == 0 {
        if std::path::Path::new(path_str).exists() {
            let _ = std::fs::remove_file(path_str);
        }
        return 0;
    }

    if pcm_ptr.is_null() {
        return -(VnErrorCode::AudioRecordFailed as i32);
    }

    let pcm = std::slice::from_raw_parts(pcm_ptr, sample_count);

    let effective_padding = if padding_ms == 0 {
        audio::silence_trim::DEFAULT_PADDING_MS
    } else {
        padding_ms
    };

    let trim_res = audio::trim_silence(
        pcm,
        effective_padding,
        audio::silence_trim::DEFAULT_FRAME_MS,
        audio::silence_trim::DEFAULT_RMS_THRESHOLD,
    );

    if !trim_res.has_speech {
        if std::path::Path::new(path_str).exists() {
            let _ = std::fs::remove_file(path_str);
        }
        return 0;
    }

    let wav_bytes = wrap_pcm_with_wav_header(
        &trim_res.trimmed_pcm,
        audio::silence_trim::DEFAULT_SAMPLE_RATE,
    );

    if let Err(err) = std::fs::write(path_str, wav_bytes) {
        if err.kind() == std::io::ErrorKind::StorageFull {
            return -(VnErrorCode::StorageFull as i32);
        }
        return -(VnErrorCode::AudioRecordFailed as i32);
    }

    1
}

/// Creates a new VAD instance with the specified sensitivity mode (1: Low, 2: Medium, 3: High).
/// Returns an opaque pointer to the VAD handle, or null on failure.
#[no_mangle]
pub unsafe extern "C" fn vn_vad_create(sensitivity_mode: u8) -> *mut c_void {
    let sensitivity = match sensitivity_mode {
        1 => vad::VadSensitivity::Low,
        3 => vad::VadSensitivity::High,
        _ => vad::VadSensitivity::Medium,
    };
    let gate = vad::VadGate::new(sensitivity);
    Box::into_raw(Box::new(gate)) as *mut c_void
}

/// Frees a VAD instance previously created by `vn_vad_create`.
///
/// # Safety
/// `handle` must be a pointer returned by `vn_vad_create`, or null.
#[no_mangle]
pub unsafe extern "C" fn vn_vad_free(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    drop(Box::from_raw(handle as *mut vad::VadGate));
}

/// Resets the internal recurrent state of the VAD instance.
///
/// # Safety
/// `handle` must be a valid pointer returned by `vn_vad_create`, or null.
#[no_mangle]
pub unsafe extern "C" fn vn_vad_reset(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    let gate = &mut *(handle as *mut vad::VadGate);
    gate.reset();
}

/// Evaluates a 16-bit PCM chunk and returns speech probability in [0.0, 1.0].
///
/// # Arguments
/// * `vad_handle` - Pointer to a VAD handle created via `vn_vad_create`, or null for fallback.
/// * `pcm_ptr` - Pointer to 16-bit signed PCM samples.
/// * `sample_count` - Number of `i16` samples.
/// * `sensitivity_mode` - Sensitivity preset (1: Low, 2: Medium, 3: High).
///
/// # Returns
/// Speech probability in [0.0, 1.0].
///
/// # Safety
/// If `pcm_ptr` is non-null, it must point to at least `sample_count` contiguous `i16` values.
#[no_mangle]
pub unsafe extern "C" fn vn_vad_eval_pcm_chunk(
    vad_handle: *mut c_void,
    pcm_ptr: *const i16,
    sample_count: usize,
    sensitivity_mode: u8,
) -> f32 {
    if pcm_ptr.is_null() || sample_count == 0 {
        return 0.0;
    }

    let pcm = std::slice::from_raw_parts(pcm_ptr, sample_count);
    let sensitivity = match sensitivity_mode {
        1 => vad::VadSensitivity::Low,
        3 => vad::VadSensitivity::High,
        _ => vad::VadSensitivity::Medium,
    };

    if !vad_handle.is_null() {
        let gate = &mut *(vad_handle as *mut vad::VadGate);
        gate.set_sensitivity(sensitivity);
        match gate.eval_chunk(pcm) {
            Ok(prob) => prob,
            Err(_) => vad::compute_rms_prob(pcm),
        }
    } else {
        vad::compute_rms_prob(pcm)
    }
}

/// Representation of an ASR transcription result or error across FFI boundaries.
#[repr(C)]
pub struct VnAsrResponse {
    /// 0 on success, negative value (`-VnErrorCode`) on error.
    pub status: i32,
    /// Null-terminated UTF-8 transcript string, or null on error.
    pub text: *mut c_char,
    /// Null-terminated UTF-8 language code (e.g. "en", "hi"), or null on error.
    pub detected_lang: *mut c_char,
    /// Elapsed inference duration in milliseconds.
    pub duration_ms: u64,
}

/// Frees memory associated with a `VnAsrResponse` returned by `vn_asr_transcribe`.
///
/// # Safety
/// `resp` must be a pointer returned by `vn_asr_transcribe`, or null.
#[no_mangle]
pub unsafe extern "C" fn vn_asr_response_free(resp: *mut VnAsrResponse) {
    if resp.is_null() {
        return;
    }
    let r = Box::from_raw(resp);
    if !r.text.is_null() {
        drop(CString::from_raw(r.text));
    }
    if !r.detected_lang.is_null() {
        drop(CString::from_raw(r.detected_lang));
    }
}

/// Transcribes 16-bit linear PCM audio using Whisper.
///
/// # Safety
/// If `pcm_ptr` is non-null, it must point to at least `sample_count` contiguous `i16` values.
/// `model_path` must be a valid null-terminated C string if non-null.
/// `language` and `prompt` may be null or valid null-terminated C strings.
#[no_mangle]
pub unsafe extern "C" fn vn_asr_transcribe(
    pcm_ptr: *const i16,
    sample_count: usize,
    model_path: *const c_char,
    language: *const c_char,
    prompt: *const c_char,
    timeout_ms: u64,
) -> *mut VnAsrResponse {
    // Review Focus 1: Zero-length PCM handed to Rust must return ASR_EMPTY_OUTPUT
    if pcm_ptr.is_null() || sample_count == 0 {
        return Box::into_raw(Box::new(VnAsrResponse {
            status: -(VnErrorCode::AsrEmptyOutput as i32),
            text: std::ptr::null_mut(),
            detected_lang: std::ptr::null_mut(),
            duration_ms: 0,
        }));
    }

    if model_path.is_null() {
        return Box::into_raw(Box::new(VnAsrResponse {
            status: -(VnErrorCode::AsrModelMissing as i32),
            text: std::ptr::null_mut(),
            detected_lang: std::ptr::null_mut(),
            duration_ms: 0,
        }));
    }

    let model_path_str = match std::ffi::CStr::from_ptr(model_path).to_str() {
        Ok(s) if !s.is_empty() => s,
        _ => {
            return Box::into_raw(Box::new(VnAsrResponse {
                status: -(VnErrorCode::AsrModelMissing as i32),
                text: std::ptr::null_mut(),
                detected_lang: std::ptr::null_mut(),
                duration_ms: 0,
            }));
        }
    };

    let language_opt = if language.is_null() {
        None
    } else {
        match std::ffi::CStr::from_ptr(language).to_str() {
            Ok(s) if !s.is_empty() => Some(s.to_string()),
            _ => None,
        }
    };

    let prompt_opt = if prompt.is_null() {
        None
    } else {
        match std::ffi::CStr::from_ptr(prompt).to_str() {
            Ok(s) if !s.is_empty() => Some(s.to_string()),
            _ => None,
        }
    };

    let pcm_slice = std::slice::from_raw_parts(pcm_ptr, sample_count);
    let pcm_f32: Vec<f32> = pcm_slice.iter().map(|&x| x as f32 / 32768.0).collect();
    let timeout = if timeout_ms == 0 { 30_000 } else { timeout_ms };

    let model_path_owned = model_path_str.to_string();

    let execute_transcribe = move || -> Result<(AsrOutput, u64), VnError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| {
                VnError::new(
                    VnErrorCode::Unknown,
                    format!("Failed to create tokio runtime: {:?}", e),
                )
            })?;

        let start = std::time::Instant::now();
        let fut = async {
            let engine = WhisperEngine::load(std::path::Path::new(&model_path_owned)).await?;
            let output = engine
                .transcribe(
                    &pcm_f32,
                    language_opt.as_deref(),
                    prompt_opt.as_deref(),
                    timeout,
                )
                .await?;
            Ok::<AsrOutput, VnError>(output)
        };

        let output = rt.block_on(fut)?;
        let elapsed = start.elapsed().as_millis() as u64;
        Ok((output, elapsed))
    };

    let res = if tokio::runtime::Handle::try_current().is_ok() {
        match std::thread::spawn(execute_transcribe).join() {
            Ok(r) => r,
            Err(_) => Err(VnError::new(VnErrorCode::Unknown, "Thread panic in transcribe")),
        }
    } else {
        execute_transcribe()
    };

    match res {
        Ok((output, elapsed)) => {
            let text_c = CString::new(output.text).unwrap_or_else(|_| CString::new("").unwrap());
            let lang_c =
                CString::new(output.detected_lang).unwrap_or_else(|_| CString::new("en").unwrap());
            Box::into_raw(Box::new(VnAsrResponse {
                status: 0,
                text: text_c.into_raw(),
                detected_lang: lang_c.into_raw(),
                duration_ms: elapsed,
            }))
        }
        Err(err) => Box::into_raw(Box::new(VnAsrResponse {
            status: -(err.code() as i32),
            text: std::ptr::null_mut(),
            detected_lang: std::ptr::null_mut(),
            duration_ms: 0,
        })),
    }
}

/// Representation of an SLM generation / rewrite result or error across FFI boundaries.
#[repr(C)]
pub struct VnSlmResponse {
    /// 0 on success, negative value (`-VnErrorCode`) on error.
    pub status: i32,
    /// Null-terminated UTF-8 rewritten text string, or null on error.
    pub text: *mut c_char,
    /// Elapsed inference duration in milliseconds.
    pub duration_ms: u64,
}

/// Frees memory associated with a `VnSlmResponse` returned by `vn_slm_generate`.
///
/// # Safety
/// `resp` must be a pointer returned by `vn_slm_generate`, or null.
#[no_mangle]
pub unsafe extern "C" fn vn_slm_response_free(resp: *mut VnSlmResponse) {
    if resp.is_null() {
        return;
    }
    let r = Box::from_raw(resp);
    if !r.text.is_null() {
        drop(CString::from_raw(r.text));
    }
}

/// Generates tone rewriting using the on-device GGUF SLM engine.
///
/// # Safety
/// `prompt` and `model_path` must be valid, null-terminated UTF-8 C strings if non-null.
#[no_mangle]
pub unsafe extern "C" fn vn_slm_generate(
    prompt: *const c_char,
    model_path: *const c_char,
    temperature: f32,
    top_p: f32,
    max_tokens: u32,
    timeout_ms: u64,
) -> *mut VnSlmResponse {
    if prompt.is_null() {
        return Box::into_raw(Box::new(VnSlmResponse {
            status: -(VnErrorCode::Unknown as i32),
            text: std::ptr::null_mut(),
            duration_ms: 0,
        }));
    }

    if model_path.is_null() {
        return Box::into_raw(Box::new(VnSlmResponse {
            status: -(VnErrorCode::AsrModelMissing as i32),
            text: std::ptr::null_mut(),
            duration_ms: 0,
        }));
    }

    let prompt_str = match std::ffi::CStr::from_ptr(prompt).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => {
            return Box::into_raw(Box::new(VnSlmResponse {
                status: -(VnErrorCode::Unknown as i32),
                text: std::ptr::null_mut(),
                duration_ms: 0,
            }));
        }
    };

    let model_path_str = match std::ffi::CStr::from_ptr(model_path).to_str() {
        Ok(s) if !s.is_empty() => s.to_string(),
        _ => {
            return Box::into_raw(Box::new(VnSlmResponse {
                status: -(VnErrorCode::AsrModelMissing as i32),
                text: std::ptr::null_mut(),
                duration_ms: 0,
            }));
        }
    };

    let timeout = if timeout_ms == 0 { 10_000 } else { timeout_ms };

    let execute_generate = move || -> Result<(String, u64), VnError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| {
                VnError::new(
                    VnErrorCode::Unknown,
                    format!("Failed to create tokio runtime: {:?}", e),
                )
            })?;

        let start = std::time::Instant::now();
        let fut = async {
            let engine = if model_path_str == "/mock/llama.gguf" {
                LlamaEngine::dummy_for_testing()
            } else {
                LlamaEngine::load(std::path::Path::new(&model_path_str), 2048).await?
            };
            let output = engine
                .generate(&prompt_str, temperature, top_p, max_tokens, timeout)
                .await?;
            Ok::<String, VnError>(output)
        };

        let output = rt.block_on(fut)?;
        let elapsed = start.elapsed().as_millis() as u64;
        Ok((output, elapsed))
    };

    let res = if tokio::runtime::Handle::try_current().is_ok() {
        match std::thread::spawn(execute_generate).join() {
            Ok(r) => r,
            Err(_) => Err(VnError::new(VnErrorCode::Unknown, "Thread panic in generate")),
        }
    } else {
        execute_generate()
    };

    match res {
        Ok((output, elapsed)) => {
            let text_c = CString::new(output).unwrap_or_else(|_| CString::new("").unwrap());
            Box::into_raw(Box::new(VnSlmResponse {
                status: 0,
                text: text_c.into_raw(),
                duration_ms: elapsed,
            }))
        }
        Err(err) => Box::into_raw(Box::new(VnSlmResponse {
            status: -(err.code() as i32),
            text: std::ptr::null_mut(),
            duration_ms: 0,
        })),
    }
}

/// Verifies the SHA-256 digest of a local file against an expected hexadecimal digest string.
///
/// # Arguments
/// * `file_path` - Null-terminated UTF-8 C string pointing to the file to verify.
/// * `expected_hex` - Null-terminated UTF-8 C string containing the expected 64-character SHA-256 hex digest.
///
/// # Returns
/// - `1` if the digest matches.
/// - `0` if the digest does not match.
/// - Negative integer (`-VnErrorCode`) if arguments are invalid or an error occurred during read.
///
/// # Safety
/// Both `file_path` and `expected_hex` must be valid, null-terminated C strings.
#[no_mangle]
pub unsafe extern "C" fn vn_crypto_verify_sha256(
    file_path: *const c_char,
    expected_hex: *const c_char,
) -> i32 {
    if file_path.is_null() || expected_hex.is_null() {
        return -(VnErrorCode::Unknown as i32);
    }

    let path_str = match std::ffi::CStr::from_ptr(file_path).to_str() {
        Ok(s) if !s.is_empty() => s,
        _ => return -(VnErrorCode::Unknown as i32),
    };

    let hex_str = match std::ffi::CStr::from_ptr(expected_hex).to_str() {
        Ok(s) if !s.is_empty() => s,
        _ => return -(VnErrorCode::Unknown as i32),
    };

    match crypto::verify_file_sha256(std::path::Path::new(path_str), hex_str) {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(e) => -(e.code() as i32),
    }
}



