use voicenote_core::slm::validator::{
    extract_critical_entities, validate_preservation,
};

#[test]
fn rejects_rewrite_that_drops_numbers_or_dates() {
    let raw = "The meeting is on October 15th at 3 PM with Dr. Sharma.";
    let dropped = "The meeting will be in the afternoon.";
    let res = validate_preservation(raw, dropped);
    assert!(
        !res.is_valid,
        "Rewrite dropped date, time, and name — must fail validation"
    );
    assert!(!res.missing_entities.is_empty());
    assert!(res.reason.is_some());
}

#[test]
fn accepts_faithful_rewrite() {
    let raw = "um yeah we should meet on October 15th at 3 PM with Dr. Sharma right";
    let clean = "We are scheduled to meet on October 15th at 3 PM with Dr. Sharma.";
    let res = validate_preservation(raw, clean);
    assert!(res.is_valid, "Faithful rewrite should pass: {:?}", res.reason);
    assert!(res.missing_entities.is_empty());
    assert!(res.reason.is_none());
}

#[test]
fn rejects_empty_rewritten_text() {
    let raw = "Hello world, this is a test.";
    let empty = "   ";
    let res = validate_preservation(raw, empty);
    assert!(!res.is_valid);
    assert_eq!(res.reason.as_deref(), Some("Rewritten text is empty"));
}

#[test]
fn rejects_length_ratio_too_short() {
    let raw = "This is a rather detailed sentence with important context that should not be completely squashed.";
    let too_short = "Short.";
    let res = validate_preservation(raw, too_short);
    assert!(!res.is_valid);
    assert!(res
        .reason
        .as_deref()
        .unwrap()
        .contains("Length ratio out of safe bounds"));
}

#[test]
fn rejects_length_ratio_too_long() {
    let raw = "Please call tomorrow.";
    let bloated = "Please make sure to call tomorrow morning, and also ensure that you bring all the necessary paperwork, documents, and identification as well as snacks for the long waiting period in line.";
    let res = validate_preservation(raw, bloated);
    assert!(!res.is_valid);
    assert!(res
        .reason
        .as_deref()
        .unwrap()
        .contains("Length ratio out of safe bounds"));
}

#[test]
fn preserves_currency_symbol_stripping() {
    let raw = "The price is $250 for the ticket.";
    let clean = "The price is 250 dollars for the ticket.";
    let res = validate_preservation(raw, clean);
    assert!(
        res.is_valid,
        "Currency symbol $ stripped should match 250: {:?}",
        res.reason
    );
}

#[test]
fn preserves_time_variants() {
    let raw = "Let's meet at 3pm today.";
    let clean1 = "Let us meet at 3:00 pm today.";
    assert!(validate_preservation(raw, clean1).is_valid);

    let clean2 = "Let us meet at 3:00pm today.";
    assert!(validate_preservation(raw, clean2).is_valid);

    let clean3 = "Let us meet at 3 pm today.";
    assert!(validate_preservation(raw, clean3).is_valid);
}

#[test]
fn preserves_ordinal_variants() {
    let raw = "Deadline is on October 15th.";
    let clean = "The deadline is on October 15.";
    let res = validate_preservation(raw, clean);
    assert!(res.is_valid, "15th matched by 15: {:?}", res.reason);
}

#[test]
fn entity_extraction_filters_fillers_and_sentence_starters() {
    let text = "Um hello, we are meeting Dr. Sharma on October 15th at 3pm with $250.";
    let entities = extract_critical_entities(text);
    assert!(entities.contains(&"sharma".to_string()));
    assert!(entities.contains(&"october".to_string()));
    assert!(entities.contains(&"15th".to_string()));
    assert!(entities.contains(&"3pm".to_string()));
    assert!(entities.contains(&"$250".to_string()));
    assert!(!entities.contains(&"um".to_string()));
    assert!(!entities.contains(&"we".to_string()));
}

#[test]
fn complex_meeting_rewrite_with_ordinals_and_time_variants_passes() {
    let raw = "Um so we need to schedule the quarterly planning meeting on October 15th at 3pm with Sarah and John to review the Q3 budget.";
    let clean = "We need to schedule the quarterly planning meeting on October 15 at 3:00 PM with Sarah and John to review the Q3 budget.";
    let res = validate_preservation(raw, clean);
    assert!(res.is_valid, "Expected complex meeting rewrite to pass: {:?}", res.reason);
}

#[test]
fn omissions_report_specific_missing_entities() {
    let raw = "Order 500 units for client AcmeCorp before Friday.";
    let dropped = "Order units for client before Friday.";
    let res = validate_preservation(raw, dropped);
    assert!(!res.is_valid);
    assert!(res.missing_entities.contains(&"500".to_string()));
    assert!(res.missing_entities.contains(&"acmecorp".to_string()));
}
