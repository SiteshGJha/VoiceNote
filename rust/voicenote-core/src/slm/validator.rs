use regex::Regex;
use std::sync::OnceLock;

static NUMBER_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_number_regex() -> &'static Regex {
    NUMBER_REGEX.get_or_init(|| {
        Regex::new(r"(?i)[$€₹£]?\b\d+(?:[.,]\d+)?(?:%|am|pm|st|nd|rd|th)?\b")
            .expect("Valid number regex")
    })
}

const FILLER_WORDS: &[&str] = &[
    "um", "uh", "like", "matlab", "arre", "er", "ah", "haan", "acha", "bhai", "yaar", "okay", "ok",
];

const COMMON_STARTERS: &[&str] = &[
    "the", "this", "that", "these", "those", "we", "they", "you", "it", "order",
    "please", "a", "an", "in", "on", "at", "if", "when", "there", "here", "let",
    "lets", "let's", "my", "our", "his", "her", "their", "hello", "hi", "hey",
    "so", "also", "just", "can", "could", "would", "should",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub reason: Option<String>,
    pub missing_entities: Vec<String>,
}

impl ValidationResult {
    pub fn ok() -> Self {
        Self {
            is_valid: true,
            reason: None,
            missing_entities: Vec::new(),
        }
    }

    pub fn invalid(reason: impl Into<String>, missing_entities: Vec<String>) -> Self {
        Self {
            is_valid: false,
            reason: Some(reason.into()),
            missing_entities,
        }
    }
}

fn is_capitalized_proper_noun(word: &str) -> bool {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) if first.is_ascii_uppercase() => {
            let mut count = 1;
            for c in chars {
                if !c.is_ascii_alphanumeric() && c != '_' && c != '-' {
                    return false;
                }
                count += 1;
            }
            count >= 2
        }
        _ => false,
    }
}

/// Extracts numbers, percentages, dates/times, and capitalized proper nouns from text.
pub fn extract_critical_entities(text: &str) -> Vec<String> {
    let mut entities: Vec<String> = Vec::new();

    // 1. Numbers with optional units/times (e.g. 3pm, 10am, 25%, $250, 4.5, 15th)
    let re = get_number_regex();
    for mat in re.find_iter(text) {
        let num = mat.as_str().to_lowercase();
        if !entities.contains(&num) {
            entities.push(num);
        }
    }

    // 2. Proper nouns (Capitalized words, filtering fillers and sentence starters at index 0)
    for (i, raw_word) in text.split_whitespace().enumerate() {
        let word = raw_word
            .trim_start_matches(|c: char| !c.is_ascii_alphanumeric())
            .trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
        if word.is_empty() {
            continue;
        }

        let lower_word = word.to_lowercase();
        if FILLER_WORDS.contains(&lower_word.as_str()) {
            continue;
        }

        if is_capitalized_proper_noun(word) {
            if i == 0 && COMMON_STARTERS.contains(&lower_word.as_str()) {
                continue;
            }
            if !entities.contains(&lower_word) {
                entities.push(lower_word);
            }
        }
    }

    entities
}

fn is_hour_period(entity: &str) -> bool {
    if entity.len() <= 2 {
        return false;
    }
    let (digits, suffix) = entity.split_at(entity.len() - 2);
    (suffix == "am" || suffix == "pm") && digits.chars().all(|c| c.is_ascii_digit())
}

fn is_ordinal(entity: &str) -> bool {
    if entity.len() <= 2 {
        return false;
    }
    let (digits, suffix) = entity.split_at(entity.len() - 2);
    matches!(suffix, "st" | "nd" | "rd" | "th") && digits.chars().all(|c| c.is_ascii_digit())
}

/// Validates that rewritten text faithfully preserves critical entities and reasonable length.
pub fn validate_preservation(raw_text: &str, rewritten_text: &str) -> ValidationResult {
    let trimmed_raw = raw_text.trim();
    let trimmed_rewritten = rewritten_text.trim();

    if trimmed_rewritten.is_empty() {
        return ValidationResult::invalid("Rewritten text is empty", Vec::new());
    }

    // 1. Length ratio check: rewritten length must be within 0.35x to 2.5x of raw (if raw.len() > 10)
    let raw_len = trimmed_raw.len();
    let rewritten_len = trimmed_rewritten.len();
    if raw_len > 10 {
        let ratio = rewritten_len as f32 / raw_len as f32;
        if ratio < 0.35 || ratio > 2.5 {
            return ValidationResult::invalid(
                format!("Length ratio out of safe bounds: {:.2}", ratio),
                Vec::new(),
            );
        }
    }

    // 2. Entity check: every entity extracted from raw_text must be found in rewritten_text
    let raw_entities = extract_critical_entities(trimmed_raw);
    let final_lower = trimmed_rewritten.to_lowercase();
    let mut missing = Vec::new();

    for entity in raw_entities {
        let stripped: String = entity
            .chars()
            .filter(|c| *c != '$' && *c != '€' && *c != '₹' && *c != '£')
            .collect();

        let mut found = final_lower.contains(&entity)
            || (!stripped.is_empty() && final_lower.contains(&stripped));

        // Handle time variants: "3pm" <-> "3:00 pm", "3:00pm", or "3 pm"
        if !found && is_hour_period(&entity) {
            let hour = &entity[..entity.len() - 2];
            let period = &entity[entity.len() - 2..];
            let v1 = format!("{}:00 {}", hour, period);
            let v2 = format!("{}:00{}", hour, period);
            let v3 = format!("{} {}", hour, period);
            found = final_lower.contains(&v1)
                || final_lower.contains(&v2)
                || final_lower.contains(&v3);
        }

        // Handle ordinal variants: "15th" <-> "15"
        if !found && is_ordinal(&entity) {
            let base_num = &entity[..entity.len() - 2];
            if let Ok(re) = Regex::new(&format!(r"\b{}\b", regex::escape(base_num))) {
                found = re.is_match(&final_lower);
            }
        }

        if !found {
            missing.push(entity);
        }
    }

    if !missing.is_empty() {
        return ValidationResult::invalid(
            format!("Critical entities missing: {}", missing.join(", ")),
            missing,
        );
    }

    ValidationResult::ok()
}
