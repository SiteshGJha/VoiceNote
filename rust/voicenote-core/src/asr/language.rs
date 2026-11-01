//! Bilingual / code-switched language strategy for Whisper ASR.
//!
//! Whisper detects a single dominant language per 30s window. On Hinglish
//! recordings (Hindi + English mixed in one utterance), a bare auto-detection
//! call biases the entire output toward whichever language begins the clip.
//! This module:
//! - Attaches a bilingual initial-prompt hint with technical vocabulary biasing.
//! - Forces a language for explicit user choices and unreliable short clips (<1.5s).
//! - Leaves language detection to the model only when auto-detecting on longer audio.

pub const HINGLISH_PROMPT: &str =
    "The following is a voice note in Hinglish, a mix of Hindi and English. \
    Transcribe Hindi speech in Devanagari script and English speech in Latin letters. \
    Preserve names, numbers, dates, and technical terms exactly as spoken. \
    Do not translate or summarize the content.";

pub const TECHNICAL_VOCAB_HINT: &str =
    "Vocabulary: Python, CPython, struct, C struct, GC, gc.collect, memory, runtime, API, JSON, async, RAM.";

pub const HINGLISH_EXAMPLE: &str =
    "Example: \"Meeting kal subah 10 baje hui thi, schedule update kar do.\"";

/// Strategy describing Whisper language parameter and steering prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LangStrategy {
    /// Explicit language code hint ("en" or "hi"), or `None` for Whisper auto-detection.
    pub language: Option<String>,
    /// Initial prompt passed to Whisper to steer script selection and technical vocabulary.
    pub initial_prompt: Option<String>,
}

/// Decides the Whisper language hint and bilingual prompt for an audio clip.
///
/// # Arguments
/// * `lang` - Target language ("en", "hi", "auto").
/// * `duration_ms` - Audio duration in milliseconds.
pub fn compute_language_strategy(lang: &str, duration_ms: u32) -> LangStrategy {
    let base_prompt = format!(
        "{}\n{}\n{}",
        HINGLISH_PROMPT, TECHNICAL_VOCAB_HINT, HINGLISH_EXAMPLE
    );

    let language = match lang {
        "en" => Some("en".to_string()),
        "hi" => Some("hi".to_string()),
        "auto" | _ => {
            // Whisper language detection is unreliable on clips shorter than ~1.5s.
            // Default to 'en' rather than trusting the detector on short clips.
            if duration_ms > 0 && duration_ms < 1500 {
                Some("en".to_string())
            } else {
                None
            }
        }
    };

    LangStrategy {
        language,
        initial_prompt: Some(base_prompt),
    }
}

/// Returns true if the text contains Devanagari script characters (U+0900..=U+097F).
pub fn has_devanagari(text: &str) -> bool {
    text.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c))
}

/// Returns true if the text contains ASCII Latin alphabet characters (a-z, A-Z).
pub fn has_latin(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_alphabetic())
}

/// Determines dominant detected language across segment counts with Devanagari tie-breaking.
pub fn dominant_detected_lang(en_count: usize, hi_count: usize, has_hindi_text: bool) -> &'static str {
    if hi_count > en_count {
        "hi"
    } else if has_hindi_text {
        "hi"
    } else {
        "en"
    }
}
