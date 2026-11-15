//! Android JNI bindings for voicenote-core.
//! Exposes C-FFI entry points for Java/Kotlin via JNI.

use std::ffi::{CStr, CString};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use jni::objects::{JClass, JString, JValue};
use jni::sys::{jboolean, jlong, jobject, jstring};
use jni::JNIEnv;

/// Helper to read 16-bit linear PCM from a WAV file or raw audio file.
fn read_pcm_samples(path: &Path) -> std::io::Result<Vec<i16>> {
    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;

    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        let mut idx = 12;
        while idx + 8 <= bytes.len() {
            if &bytes[idx..idx + 4] == b"data" {
                let size = u32::from_le_bytes(bytes[idx + 4..idx + 8].try_into().unwrap_or([0, 0, 0, 0])) as usize;
                let data_start = idx + 8;
                let data_end = (data_start + size).min(bytes.len());
                let pcm_bytes = &bytes[data_start..data_end];
                let sample_count = pcm_bytes.len() / 2;
                let mut samples = Vec::with_capacity(sample_count);
                for i in 0..sample_count {
                    let s = i16::from_le_bytes([pcm_bytes[i * 2], pcm_bytes[i * 2 + 1]]);
                    samples.push(s);
                }
                return Ok(samples);
            }
            let chunk_size = u32::from_le_bytes(bytes[idx + 4..idx + 8].try_into().unwrap_or([0, 0, 0, 0])) as usize;
            // Align to 2-byte boundary per RIFF spec
            idx += 8 + ((chunk_size + 1) & !1);
        }
    }

    let sample_count = bytes.len() / 2;
    let mut samples = Vec::with_capacity(sample_count);
    for i in 0..sample_count {
        let s = i16::from_le_bytes([bytes[i * 2], bytes[i * 2 + 1]]);
        samples.push(s);
    }
    Ok(samples)
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_getCoreVersion(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    let version_raw = crate::voicenote_core_version();
    let version_str = if !version_raw.is_null() {
        let s = CStr::from_ptr(version_raw).to_string_lossy().into_owned();
        crate::voicenote_core_version_free(version_raw as *mut _);
        s
    } else {
        "1.0.0".to_string()
    };

    let j_str = match env.new_string(version_str) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    j_str.into_raw()
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_verifyFileChecksum(
    mut env: JNIEnv,
    _class: JClass,
    file_path: JString,
    expected_sha256: JString,
) -> jboolean {
    let path_str: String = match env.get_string(&file_path) {
        Ok(s) => s.into(),
        Err(_) => return 0,
    };
    let sha_str: String = match env.get_string(&expected_sha256) {
        Ok(s) => s.into(),
        Err(_) => return 0,
    };

    match crate::crypto::verify_file_sha256(Path::new(&path_str), &sha_str) {
        Ok(valid) => if valid { 1 } else { 0 },
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_trimSilenceWav(
    mut env: JNIEnv,
    _class: JClass,
    input_path: JString,
    output_path: JString,
) -> jboolean {
    let in_path_str: String = match env.get_string(&input_path) {
        Ok(s) => s.into(),
        Err(_) => return 0,
    };
    let out_path_str: String = match env.get_string(&output_path) {
        Ok(s) => s.into(),
        Err(_) => return 0,
    };

    let samples = match read_pcm_samples(Path::new(&in_path_str)) {
        Ok(s) => s,
        Err(_) => return 0,
    };

    if samples.is_empty() {
        if Path::new(&out_path_str).exists() {
            let _ = std::fs::remove_file(&out_path_str);
        }
        return 0;
    }

    let out_c = match CString::new(out_path_str.as_str()) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let res = crate::vn_audio_trim_and_save_wav(
        samples.as_ptr(),
        samples.len(),
        out_c.as_ptr(),
        200,
    );

    if res == 1 { 1 } else { 0 }
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_voicenote_core_VoiceNoteCoreJni_transcribeAudio(
    mut env: JNIEnv,
    _class: JClass,
    file_path: JString,
    language: JString,
    model_path: JString,
) -> jobject {
    let path_str: String = match env.get_string(&file_path) {
        Ok(s) => s.into(),
        Err(_) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "Invalid file_path");
            return std::ptr::null_mut();
        }
    };

    let model_path_str: String = match env.get_string(&model_path) {
        Ok(s) => s.into(),
        Err(_) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "Invalid model_path");
            return std::ptr::null_mut();
        }
    };

    let lang_str: Option<String> = if !language.is_null() {
        env.get_string(&language).ok().map(|s| s.into())
    } else {
        None
    };

    let mut samples = match read_pcm_samples(Path::new(&path_str)) {
        Ok(s) => s,
        Err(e) => {
            let _ = env.throw_new("java/io/IOException", format!("Failed to read audio file: {}", e));
            return std::ptr::null_mut();
        }
    };

    if samples.is_empty() {
        let _ = env.throw_new("java/lang/IllegalStateException", "ASR_EMPTY_OUTPUT");
        return std::ptr::null_mut();
    }

    // Pad to at least 16000 samples (1s) if smaller
    if samples.len() < 16000 {
        samples.resize(16000, 0);
    }

    let c_model = match CString::new(model_path_str) {
        Ok(c) => c,
        Err(_) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "model_path contains null bytes");
            return std::ptr::null_mut();
        }
    };

    let c_lang = match lang_str {
        Some(ref l) if !l.is_empty() && l != "auto" => CString::new(l.as_str()).ok(),
        _ => None,
    };

    let lang_ptr = c_lang.as_ref().map(|c| c.as_ptr()).unwrap_or(std::ptr::null());

    let resp_ptr = crate::vn_asr_transcribe(
        samples.as_ptr(),
        samples.len(),
        c_model.as_ptr(),
        lang_ptr,
        std::ptr::null(),
        30000,
    );

    if resp_ptr.is_null() {
        let _ = env.throw_new("java/lang/RuntimeException", "ASR_TIMEOUT");
        return std::ptr::null_mut();
    }

    let resp = &*resp_ptr;
    if resp.status != 0 {
        let code = resp.status;
        crate::vn_asr_response_free(resp_ptr);
        let err_tag = match code {
            -101 => "ASR_EMPTY_OUTPUT",
            -102 => "ASR_TIMEOUT",
            -103 => "ASR_MODEL_MISSING",
            _ => "ASR_ERROR",
        };
        let _ = env.throw_new("java/lang/RuntimeException", err_tag);
        return std::ptr::null_mut();
    }

    let text_str = if !resp.text.is_null() {
        CStr::from_ptr(resp.text).to_string_lossy().into_owned()
    } else {
        String::new()
    };

    let detected_lang_str = if !resp.detected_lang.is_null() {
        CStr::from_ptr(resp.detected_lang).to_string_lossy().into_owned()
    } else {
        "en".to_string()
    };

    let duration_ms = resp.duration_ms as jlong;

    crate::vn_asr_response_free(resp_ptr);

    let j_text = match env.new_string(text_str) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let j_lang = match env.new_string(detected_lang_str) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };

    let cls = match env.find_class("com/voicenote/core/VoiceNoteAsrResult") {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };

    let obj = match env.new_object(
        cls,
        "(Ljava/lang/String;Ljava/lang/String;J)V",
        &[
            JValue::Object(&j_text),
            JValue::Object(&j_lang),
            JValue::Long(duration_ms),
        ],
    ) {
        Ok(o) => o,
        Err(_) => return std::ptr::null_mut(),
    };

    obj.into_raw()
}
