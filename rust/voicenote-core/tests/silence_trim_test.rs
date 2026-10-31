use voicenote_core::audio::silence_trim::{trim_silence, trim_silence_with_rate, TrimResult};

#[test]
fn all_silence_returns_has_speech_false() {
    let silence = vec![0i16; 16000]; // 1 second of silence at 16kHz
    let res: TrimResult = trim_silence(&silence, 200, 30, 0.04);
    assert!(!res.has_speech);
    assert!(res.trimmed_pcm.is_empty());
    assert_eq!(res.speech_start_sample, 0);
    assert_eq!(res.speech_end_sample, 0);
}

#[test]
fn trims_leading_and_trailing_silence_preserving_padding() {
    let silence_prefix = vec![0i16; 8000]; // 500ms
    let speech = vec![10000i16; 8000]; // 500ms
    let silence_suffix = vec![0i16; 8000]; // 500ms
    let full = [silence_prefix, speech, silence_suffix].concat();

    let res = trim_silence(&full, 200, 30, 0.04);
    assert!(res.has_speech);
    assert!(res.trimmed_pcm.len() < full.len());
    // Must retain at least 200ms padding on each side (3200 samples each)
    assert!(res.trimmed_pcm.len() >= 8000 + (3200 * 2));
    assert_eq!(
        res.trimmed_pcm.len(),
        res.speech_end_sample - res.speech_start_sample
    );
    assert_eq!(
        &full[res.speech_start_sample..res.speech_end_sample],
        &res.trimmed_pcm[..]
    );
}

#[test]
fn empty_pcm_returns_has_speech_false() {
    let res = trim_silence(&[], 200, 30, 0.04);
    assert!(!res.has_speech);
    assert!(res.trimmed_pcm.is_empty());
    assert_eq!(res.speech_start_sample, 0);
    assert_eq!(res.speech_end_sample, 0);
}

#[test]
fn all_speech_preserves_entire_buffer() {
    let speech = vec![12000i16; 16000]; // 1 second of speech
    let res = trim_silence(&speech, 200, 30, 0.04);
    assert!(res.has_speech);
    assert_eq!(res.trimmed_pcm.len(), speech.len());
    assert_eq!(res.speech_start_sample, 0);
    assert_eq!(res.speech_end_sample, speech.len());
    assert_eq!(res.trimmed_pcm, speech);
}

#[test]
fn speech_at_beginning_clamps_start_padding_to_zero() {
    let speech = vec![10000i16; 4800]; // 300ms speech
    let silence = vec![0i16; 16000]; // 1s silence
    let full = [speech, silence].concat();

    let res = trim_silence(&full, 200, 30, 0.04);
    assert!(res.has_speech);
    assert_eq!(res.speech_start_sample, 0);
    // 300ms speech + 200ms trailing padding = 500ms = 8000 samples
    assert!(res.trimmed_pcm.len() >= 4800 + 3200);
    assert!(res.trimmed_pcm.len() < full.len());
}

#[test]
fn speech_at_end_clamps_end_padding_to_len() {
    let silence = vec![0i16; 16000]; // 1s silence
    let speech = vec![10000i16; 4800]; // 300ms speech
    let full = [silence, speech].concat();

    let res = trim_silence(&full, 200, 30, 0.04);
    assert!(res.has_speech);
    assert_eq!(res.speech_end_sample, full.len());
    assert!(res.trimmed_pcm.len() >= 4800 + 3200);
    assert!(res.trimmed_pcm.len() < full.len());
}

#[test]
fn custom_sample_rate_and_zero_frame_safety() {
    // Zero frame ms should safely return no speech rather than panic or divide by zero
    let pcm = vec![10000i16; 1600];
    let zero_frame = trim_silence(&pcm, 200, 0, 0.04);
    assert!(!zero_frame.has_speech);

    // Custom sample rate: 8000 Hz, 100ms padding = 800 samples
    let silence_pre = vec![0i16; 4000]; // 500ms
    let speech = vec![10000i16; 4000]; // 500ms
    let silence_post = vec![0i16; 4000]; // 500ms
    let full = [silence_pre, speech, silence_post].concat();
    let res = trim_silence_with_rate(&full, 100, 20, 0.04, 8000);
    assert!(res.has_speech);
    assert!(res.trimmed_pcm.len() >= 4000 + (800 * 2));
    assert!(res.trimmed_pcm.len() < full.len());
}
