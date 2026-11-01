pub mod asr;
pub mod audio;
pub mod errors;
pub mod vad;

pub use asr::{AsrOutput, WhisperEngine};
pub use audio::{
    trim_silence, trim_silence_with_rate, wrap_pcm_with_wav_header, AudioBuffer, TrimResult,
};
pub use errors::{VnError, VnErrorCode};

use std::ffi::CString;
use std::os::raw::{c_char, c_void};

#[no_mangle]
pub extern "C" fn voicenote_core_version() -> *const c_char {
    CString::new("0.1.0").unwrap().into_raw()
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
    match vad::VadGate::new_default(sensitivity) {
        Ok(gate) => Box::into_raw(Box::new(gate)) as *mut c_void,
        Err(_) => {
            let gate = vad::VadGate::new_rms(sensitivity);
            Box::into_raw(Box::new(gate)) as *mut c_void
        }
    }
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

