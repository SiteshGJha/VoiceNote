use std::fs;
use voicenote_core::audio::AudioBuffer;

#[test]
fn zero_length_pcm_does_not_panic() {
    let buf = AudioBuffer::from_pcm(vec![], None);
    assert_eq!(buf.sample_count(), 0);
    assert_eq!(buf.duration_ms(), 0);
    assert!(buf.as_f32_normalized().is_empty());
}

#[test]
fn drop_deletes_temp_file_on_interruption_or_scope_exit() {
    let temp = std::env::temp_dir().join(format!("vn_ephemeral_test_{}.wav", std::process::id()));
    fs::write(&temp, b"RIFF dummy").unwrap();
    assert!(temp.exists());
    {
        let _buf = AudioBuffer::from_pcm(vec![0; 1600], Some(temp.clone()));
    } // dropped here
    assert!(
        !temp.exists(),
        "AudioBuffer Drop MUST strictly delete temporary file"
    );
}

#[test]
fn normalizes_i16_to_f32_accurately() {
    let pcm = vec![i16::MAX, 0, i16::MIN + 1, i16::MIN];
    let buf = AudioBuffer::from_pcm(pcm, None);
    let f = buf.as_f32_normalized();
    assert!((f[0] - 1.0).abs() < 0.001);
    assert_eq!(f[1], 0.0);
    assert!((f[2] - (-1.0)).abs() < 0.001);
    assert_eq!(f[3], -1.0);
}

#[test]
fn slice_and_duration_calculation() {
    let pcm = vec![100, 200, -300, 400];
    let buf = AudioBuffer::from_pcm(pcm.clone(), None);
    assert_eq!(buf.as_i16_slice(), &[100, 200, -300, 400]);
    assert_eq!(buf.sample_count(), 4);
    // Default 16000 Hz: 4 samples = 4 * 1000 / 16000 = 0 ms
    assert_eq!(buf.duration_ms(), 0);

    let pcm_1sec = vec![0; 16000];
    let buf_1sec = AudioBuffer::from_pcm(pcm_1sec, None);
    assert_eq!(buf_1sec.sample_count(), 16000);
    assert_eq!(buf_1sec.duration_ms(), 1000);
}

#[test]
fn nonexistent_temp_file_on_drop_does_not_panic() {
    let nonexistent =
        std::env::temp_dir().join(format!("vn_nonexistent_{}.wav", std::process::id()));
    if nonexistent.exists() {
        let _ = fs::remove_file(&nonexistent);
    }
    {
        let _buf = AudioBuffer::from_pcm(vec![1, 2, 3], Some(nonexistent.clone()));
    }
    assert!(!nonexistent.exists());
}

#[test]
fn custom_sample_rate_and_zero_rate_safety() {
    let buf_custom = AudioBuffer::from_pcm_with_rate(vec![0; 8000], 8000, None);
    assert_eq!(buf_custom.sample_rate(), 8000);
    assert_eq!(buf_custom.duration_ms(), 1000);

    let buf_zero_rate = AudioBuffer::from_pcm_with_rate(vec![0; 1600], 0, None);
    assert_eq!(buf_zero_rate.sample_rate(), 0);
    assert_eq!(buf_zero_rate.duration_ms(), 0);
}
