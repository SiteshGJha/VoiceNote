use voicenote_core::vad::presets::VadSensitivity;
use voicenote_core::vad::silero::SileroVad;
use voicenote_core::VnErrorCode;

static MODEL_BYTES: &[u8] = include_bytes!("../../../assets/silero_vad.onnx");

#[test]
fn silero_vad_detects_silence_below_threshold() {
    let mut vad = SileroVad::new(MODEL_BYTES, VadSensitivity::Medium).unwrap();
    let zero_frame = vec![0.0f32; 512];
    let prob = vad.process_frame_512(&zero_frame).unwrap();
    assert!(prob < 0.1, "Silence probability must be < 0.1, got {}", prob);
}

#[test]
fn silero_vad_detects_speech_above_threshold() {
    let mut vad = SileroVad::new(MODEL_BYTES, VadSensitivity::Medium).unwrap();

    // First feed 5 frames of silence to stabilize state
    let silence = vec![0.0f32; 512];
    for _ in 0..5 {
        let prob = vad.process_frame_512(&silence).unwrap();
        assert!(prob < 0.1);
    }

    // Now feed synthetic 400Hz speech frames
    let mut speech_frames = Vec::new();
    for frame_idx in 0..4 {
        let mut frame = vec![0.0f32; 512];
        for i in 0..512 {
            let t = (frame_idx * 512 + i) as f32 / 16000.0;
            frame[i] = (2.0 * std::f32::consts::PI * 400.0 * t).sin() * 0.85;
        }
        speech_frames.push(frame);
    }

    let mut final_prob = 0.0f32;
    for frame in &speech_frames {
        final_prob = vad.process_frame_512(frame).unwrap();
    }

    assert!(
        final_prob > 0.5,
        "Speech probability should exceed 0.5 after speech frames, got {}",
        final_prob
    );
    assert!(
        vad.is_speech(&speech_frames[3]).unwrap(),
        "is_speech should return true"
    );
}

#[test]
fn silero_vad_respects_sensitivity_presets() {
    let low = VadSensitivity::Low;
    let med = VadSensitivity::Medium;
    let high = VadSensitivity::High;

    assert_eq!(low.threshold(), 0.6);
    assert_eq!(med.threshold(), 0.5);
    assert_eq!(high.threshold(), 0.4);

    assert_eq!(low.silence_window_ms(), 2000);
    assert_eq!(med.silence_window_ms(), 1500);
    assert_eq!(high.silence_window_ms(), 1000);

    let mut vad = SileroVad::new(MODEL_BYTES, VadSensitivity::High).unwrap();
    assert_eq!(vad.sensitivity(), VadSensitivity::High);

    vad.set_sensitivity(VadSensitivity::Low);
    assert_eq!(vad.sensitivity(), VadSensitivity::Low);
}

#[test]
fn silero_vad_invalid_frame_size_returns_error() {
    let mut vad = SileroVad::new(MODEL_BYTES, VadSensitivity::Medium).unwrap();

    let short_frame = vec![0.0f32; 256];
    let err = vad.process_frame_512(&short_frame).unwrap_err();
    assert_eq!(err.code(), VnErrorCode::AudioRecordFailed);

    let long_frame = vec![0.0f32; 1024];
    let err2 = vad.process_frame_512(&long_frame).unwrap_err();
    assert_eq!(err2.code(), VnErrorCode::AudioRecordFailed);
}

#[test]
fn silero_vad_empty_or_corrupted_model_bytes_returns_error() {
    let empty_bytes = b"";
    let err = SileroVad::new(empty_bytes, VadSensitivity::Medium).unwrap_err();
    assert_eq!(err.code(), VnErrorCode::AsrModelMissing);

    let corrupted_bytes = b"NOT_AN_ONNX_MODEL";
    let err2 = SileroVad::new(corrupted_bytes, VadSensitivity::Medium).unwrap_err();
    assert_eq!(err2.code(), VnErrorCode::Unknown);
}

#[test]
fn silero_vad_reset_state_clears_lstm_memory() {
    let mut vad = SileroVad::new(MODEL_BYTES, VadSensitivity::Medium).unwrap();

    // Push speech frames
    for i in 0..5 {
        let mut frame = vec![0.0f32; 512];
        for j in 0..512 {
            let t = (i * 512 + j) as f32 / 16000.0;
            frame[j] = (2.0 * std::f32::consts::PI * 300.0 * t).sin() * 0.9;
        }
        let _ = vad.process_frame_512(&frame).unwrap();
    }

    // Reset state
    vad.reset_state();

    // Immediately test zero frame
    let zero_frame = vec![0.0f32; 512];
    let prob = vad.process_frame_512(&zero_frame).unwrap();
    assert!(
        prob < 0.1,
        "After reset, zero frame should yield low silence prob, got {}",
        prob
    );
}
