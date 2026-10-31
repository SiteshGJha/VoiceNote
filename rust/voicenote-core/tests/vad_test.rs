use voicenote_core::vad::gate::{VadGate, VadState};
use voicenote_core::vad::presets::VadSensitivity;
use voicenote_core::vad::silero::SileroVad;
use voicenote_core::VnErrorCode;
use voicenote_core::{vn_vad_create, vn_vad_eval_pcm_chunk, vn_vad_free, vn_vad_reset};

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

#[test]
fn vad_gate_detects_speech_and_transitions_state() {
    let vad = SileroVad::new(MODEL_BYTES, VadSensitivity::Medium).unwrap();
    let mut gate = VadGate::new(vad, VadSensitivity::Medium);

    assert_eq!(gate.state(), VadState::Idle);
    assert!(!gate.has_detected_speech());

    // First feed 5 silence frames to establish noise floor
    let silent_frame = vec![0i16; 480];
    for _ in 0..5 {
        let res = gate.process_frame(&silent_frame, 30).unwrap();
        assert!(!res.is_speech);
        assert_eq!(gate.state(), VadState::Idle);
    }

    // Generate 480-sample (30ms) continuous speech frames (400Hz sine wave)
    // Feed 12 speech frames (360ms) to satisfy min_speech_ms (300ms)
    let mut last_prob = 0.0f32;
    for frame_idx in 0..12 {
        let mut speech_frame = vec![0i16; 480];
        for i in 0..480 {
            let t = (frame_idx * 480 + i) as f32 / 16000.0;
            speech_frame[i] = ((2.0 * std::f32::consts::PI * 400.0 * t).sin() * 25000.0) as i16;
        }
        let res = gate.process_frame(&speech_frame, 30).unwrap();
        last_prob = res.probability;
    }

    assert!(last_prob > 0.45, "Final speech probability should be > 0.45, got {}", last_prob);
    assert_eq!(gate.state(), VadState::Speech);
    assert!(gate.has_detected_speech());

    // Now feed silence frames until speech ceases and gate transitions to silence
    let mut transitioned_to_silence = false;
    for _ in 0..5 {
        let res = gate.process_frame(&silent_frame, 30).unwrap();
        if gate.state() == VadState::Silence {
            transitioned_to_silence = true;
            assert!(!res.is_speech);
            break;
        }
    }
    assert!(transitioned_to_silence, "Gate should transition to Silence");
}

#[test]
fn vad_gate_auto_stop_triggers_after_silence_window() {
    let vad = SileroVad::new(MODEL_BYTES, VadSensitivity::High).unwrap();
    // High sensitivity: silence window is 1000 ms
    let mut gate = VadGate::new(vad, VadSensitivity::High);

    let silent_frame = vec![0i16; 480];
    for _ in 0..5 {
        let _ = gate.process_frame(&silent_frame, 30).unwrap();
    }

    // 12 continuous speech frames (360 ms)
    for frame_idx in 0..12 {
        let mut speech_frame = vec![0i16; 480];
        for i in 0..480 {
            let t = (frame_idx * 480 + i) as f32 / 16000.0;
            speech_frame[i] = ((2.0 * std::f32::consts::PI * 400.0 * t).sin() * 25000.0) as i16;
        }
        let _ = gate.process_frame(&speech_frame, 30).unwrap();
    }
    assert_eq!(gate.state(), VadState::Speech);
    assert!(!gate.has_auto_stopped());

    // Feed 45 silent frames (45 * 30ms = 1350 ms > 1000ms threshold)
    let mut auto_stopped = false;
    for _ in 0..45 {
        let res = gate.process_frame(&silent_frame, 30).unwrap();
        if res.auto_stopped {
            auto_stopped = true;
            break;
        }
    }

    assert!(auto_stopped);
    assert!(gate.has_auto_stopped());
}

#[test]
fn vad_gate_reset_clears_state() {
    let vad = SileroVad::new(MODEL_BYTES, VadSensitivity::High).unwrap();
    let mut gate = VadGate::new(vad, VadSensitivity::High);

    let silent_frame = vec![0i16; 480];
    for _ in 0..5 {
        let _ = gate.process_frame(&silent_frame, 30).unwrap();
    }

    for frame_idx in 0..12 {
        let mut speech_frame = vec![0i16; 480];
        for i in 0..480 {
            let t = (frame_idx * 480 + i) as f32 / 16000.0;
            speech_frame[i] = ((2.0 * std::f32::consts::PI * 400.0 * t).sin() * 25000.0) as i16;
        }
        let _ = gate.process_frame(&speech_frame, 30).unwrap();
    }
    assert_eq!(gate.state(), VadState::Speech);
    assert!(gate.has_detected_speech());

    gate.reset();
    assert_eq!(gate.state(), VadState::Idle);
    assert!(!gate.has_detected_speech());
    assert!(!gate.has_auto_stopped());
}

#[test]
fn vn_vad_eval_pcm_chunk_c_abi() {
    unsafe {
        let handle = vn_vad_create(2);
        assert!(!handle.is_null());

        let silent_pcm = vec![0i16; 480];
        let mut prob_silence = 0.0f32;
        for _ in 0..5 {
            prob_silence = vn_vad_eval_pcm_chunk(handle, silent_pcm.as_ptr(), silent_pcm.len(), 2);
        }
        assert!(prob_silence < 0.2, "Silence prob should be low, got {}", prob_silence);

        // Evaluate continuous speech chunks
        let mut speech_prob = 0.0f32;
        for frame_idx in 0..10 {
            let mut speech_pcm = vec![0i16; 480];
            for i in 0..480 {
                let t = (frame_idx * 480 + i) as f32 / 16000.0;
                speech_pcm[i] = ((2.0 * std::f32::consts::PI * 400.0 * t).sin() * 25000.0) as i16;
            }
            speech_prob = vn_vad_eval_pcm_chunk(handle, speech_pcm.as_ptr(), speech_pcm.len(), 2);
        }
        assert!(speech_prob > 0.4, "Speech prob should be high, got {}", speech_prob);

        // Reset
        vn_vad_reset(handle);

        // Free
        vn_vad_free(handle);

        // Test with null handle (should fallback to RMS safely)
        let mut fallback_pcm = vec![0i16; 480];
        for i in 0..480 {
            let t = i as f32 / 16000.0;
            fallback_pcm[i] = ((2.0 * std::f32::consts::PI * 400.0 * t).sin() * 25000.0) as i16;
        }
        let prob_fallback = vn_vad_eval_pcm_chunk(std::ptr::null_mut(), fallback_pcm.as_ptr(), fallback_pcm.len(), 2);
        assert!(prob_fallback > 0.3);

        let prob_null_pcm = vn_vad_eval_pcm_chunk(std::ptr::null_mut(), std::ptr::null(), 0, 2);
        assert_eq!(prob_null_pcm, 0.0);
    }
}

