use std::ffi::CString;
use std::path::Path;
use voicenote_core::asr::whisper::WhisperEngine;
use voicenote_core::errors::VnErrorCode;
use voicenote_core::{vn_asr_response_free, vn_asr_transcribe};

#[tokio::test]
async fn loading_nonexistent_whisper_model_fails_with_model_missing() {
    let err = WhisperEngine::load(Path::new("/invalid/model.bin"))
        .await
        .unwrap_err();
    assert_eq!(err.code(), VnErrorCode::AsrModelMissing);
}

#[tokio::test]
async fn empty_audio_returns_asr_empty_output() {
    let engine = WhisperEngine::dummy_for_testing();
    let err = engine
        .transcribe(&[], None, None, 1000)
        .await
        .unwrap_err();
    assert_eq!(err.code(), VnErrorCode::AsrEmptyOutput);
}

#[test]
fn vn_asr_transcribe_null_or_empty_pcm_returns_asr_empty_output() {
    let model_path = CString::new("/mock/model.bin").unwrap();
    let resp = unsafe {
        vn_asr_transcribe(
            std::ptr::null(),
            0,
            model_path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1000,
        )
    };
    assert!(!resp.is_null());
    unsafe {
        assert_eq!((*resp).status, -(VnErrorCode::AsrEmptyOutput as i32));
        assert!((*resp).text.is_null());
        assert!((*resp).detected_lang.is_null());
        vn_asr_response_free(resp);
    }
}

#[test]
fn vn_asr_transcribe_null_model_path_returns_asr_model_missing() {
    let pcm = vec![1000i16; 160];
    let resp = unsafe {
        vn_asr_transcribe(
            pcm.as_ptr(),
            pcm.len(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            1000,
        )
    };
    assert!(!resp.is_null());
    unsafe {
        assert_eq!((*resp).status, -(VnErrorCode::AsrModelMissing as i32));
        vn_asr_response_free(resp);
    }
}
