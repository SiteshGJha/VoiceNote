pub mod audio;
pub mod errors;

pub use audio::{
    trim_silence, trim_silence_with_rate, wrap_pcm_with_wav_header, AudioBuffer, TrimResult,
};
pub use errors::{VnError, VnErrorCode};

use std::ffi::CString;
use std::os::raw::c_char;

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
