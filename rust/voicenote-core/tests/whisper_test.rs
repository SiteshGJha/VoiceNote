use std::path::Path;
use voicenote_core::asr::whisper::WhisperEngine;
use voicenote_core::errors::VnErrorCode;

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
