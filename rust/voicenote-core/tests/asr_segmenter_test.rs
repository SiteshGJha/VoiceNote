use voicenote_core::asr::language::{
    compute_language_strategy, dominant_detected_lang, has_devanagari, has_latin, LangStrategy,
};
use voicenote_core::asr::segmenter::{compute_segment_boundaries, compute_normalized_rms};

#[test]
fn short_clip_under_1500ms_defaults_to_en() {
    let strat: LangStrategy = compute_language_strategy("auto", 1200);
    assert_eq!(strat.language.as_deref(), Some("en"));
    assert!(strat.initial_prompt.is_some());
    let prompt = strat.initial_prompt.unwrap();
    assert!(prompt.contains("Hinglish"));
    assert!(prompt.contains("CPython"));
    assert!(prompt.contains("Example:"));
}

#[test]
fn explicit_languages_honored() {
    let strat_en = compute_language_strategy("en", 5000);
    assert_eq!(strat_en.language.as_deref(), Some("en"));

    let strat_hi = compute_language_strategy("hi", 5000);
    assert_eq!(strat_hi.language.as_deref(), Some("hi"));

    let strat_auto_long = compute_language_strategy("auto", 5000);
    assert_eq!(strat_auto_long.language, None);
}

#[test]
fn script_detection_and_dominant_language() {
    assert!(has_devanagari("यह एक परीक्षण है"));
    assert!(!has_devanagari("This is a test"));
    assert!(has_latin("This is a test"));
    assert!(!has_latin("यह एक परीक्षण है"));

    assert_eq!(dominant_detected_lang(2, 1, false), "en");
    assert_eq!(dominant_detected_lang(1, 2, false), "hi");
    assert_eq!(dominant_detected_lang(1, 1, true), "hi"); // Devanagari tie breaker
    assert_eq!(dominant_detected_lang(1, 1, false), "en");
}

#[test]
fn clips_shorter_than_max_segment_return_single_boundary() {
    // 5 seconds of audio = 80,000 samples
    let pcm = vec![1000i16; 16000 * 5];
    let bounds = compute_segment_boundaries(&pcm, 27000, 200);
    assert_eq!(bounds.len(), 1);
    assert_eq!(bounds[0], (0, 16000 * 5));
}

#[test]
fn clips_longer_than_27s_are_split_at_silence() {
    // 30 seconds of audio with a silence gap at second 20 (samples 320,000..336,000)
    let mut pcm = vec![1000i16; 16000 * 30];
    for i in (16000 * 20)..(16000 * 21) {
        pcm[i] = 0;
    }
    let bounds = compute_segment_boundaries(&pcm, 27000, 200);
    assert!(bounds.len() >= 2);
    assert_eq!(bounds[0].0, 0);
    assert_eq!(bounds.last().unwrap().1, 16000 * 30);

    // Ensure the cut happens within the silence region (around 16000 * 20.5)
    let cut_point = bounds[0].1;
    assert!(cut_point >= 16000 * 20 && cut_point <= 16000 * 21);
    assert_eq!(bounds[1].0, cut_point);
}

#[test]
fn continuous_speech_without_silence_splits_at_window_end() {
    // 40 seconds of continuous speech (640,000 samples)
    let pcm = vec![2000i16; 16000 * 40];
    let max_segment_ms = 20_000; // 20s = 320,000 samples
    let bounds = compute_segment_boundaries(&pcm, max_segment_ms, 200);

    assert_eq!(bounds.len(), 2);
    assert_eq!(bounds[0], (0, 320000));
    assert_eq!(bounds[1], (320000, 640000));
}

#[test]
fn empty_pcm_returns_empty_boundaries() {
    let bounds = compute_segment_boundaries(&[], 27000, 200);
    assert!(bounds.is_empty());
}

#[test]
fn normalized_rms_calculation() {
    let zeros = vec![0i16; 480];
    assert_eq!(compute_normalized_rms(&zeros), 0.0);

    let low = vec![1000i16; 480];
    let low_rms = compute_normalized_rms(&low);
    assert!((low_rms - 0.125).abs() < 0.001);

    let high = vec![16000i16; 480];
    assert_eq!(compute_normalized_rms(&high), 1.0);
}
