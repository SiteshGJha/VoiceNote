use std::ffi::CString;
use std::fs;
use voicenote_core::audio::wav::wrap_pcm_with_wav_header;
use voicenote_core::{vn_audio_trim_and_save_wav, VnErrorCode};

#[test]
fn creates_valid_44_byte_riff_wave_header() {
    let pcm = vec![0i16; 160];
    let bytes = wrap_pcm_with_wav_header(&pcm, 16000);
    assert_eq!(bytes.len(), 44 + 320);
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    assert_eq!(&bytes[12..16], b"fmt ");
    assert_eq!(&bytes[36..40], b"data");
}

#[test]
fn header_encodes_sample_rate_and_little_endian_samples() {
    let pcm = vec![0x1234i16, -2i16];
    let bytes = wrap_pcm_with_wav_header(&pcm, 44100);
    assert_eq!(bytes.len(), 44 + 4);

    // Chunk size: 36 + 4 = 40
    let chunk_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert_eq!(chunk_size, 40);

    // fmt subchunk size: 16
    let fmt_size = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    assert_eq!(fmt_size, 16);

    // Audio format: 1 (PCM)
    let audio_fmt = u16::from_le_bytes(bytes[20..22].try_into().unwrap());
    assert_eq!(audio_fmt, 1);

    // Channels: 1 (Mono)
    let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
    assert_eq!(channels, 1);

    // Sample rate: 44100
    let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
    assert_eq!(rate, 44100);

    // Byte rate: 44100 * 2 = 88200
    let byte_rate = u32::from_le_bytes(bytes[28..32].try_into().unwrap());
    assert_eq!(byte_rate, 88200);

    // Block align: 2
    let block_align = u16::from_le_bytes(bytes[32..34].try_into().unwrap());
    assert_eq!(block_align, 2);

    // Bits per sample: 16
    let bits = u16::from_le_bytes(bytes[34..36].try_into().unwrap());
    assert_eq!(bits, 16);

    // Data size: 4
    let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
    assert_eq!(data_size, 4);

    // Sample 0: 0x1234 -> [0x34, 0x12]
    assert_eq!(&bytes[44..46], &[0x34, 0x12]);
    // Sample 1: -2i16 (0xFFFE) -> [0xFE, 0xFF]
    assert_eq!(&bytes[46..48], &[0xFE, 0xFF]);
}

#[test]
fn empty_pcm_creates_valid_44_byte_header_with_zero_data() {
    let pcm: Vec<i16> = Vec::new();
    let bytes = wrap_pcm_with_wav_header(&pcm, 16000);
    assert_eq!(bytes.len(), 44);

    let chunk_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert_eq!(chunk_size, 36);

    let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
    assert_eq!(data_size, 0);
}

#[test]
fn trim_and_save_wav_with_speech_writes_wav_file_and_returns_1() {
    let temp_file = std::env::temp_dir().join(format!("test_speech_{}.wav", std::process::id()));
    if temp_file.exists() {
        let _ = fs::remove_file(&temp_file);
    }

    // 500ms silence, 500ms speech (high amplitude), 500ms silence at 16kHz
    let silence = vec![0i16; 8000];
    let speech = vec![12000i16; 8000];
    let full = [silence.clone(), speech, silence].concat();

    let path_c = CString::new(temp_file.to_str().unwrap()).unwrap();

    let ret = unsafe {
        vn_audio_trim_and_save_wav(
            full.as_ptr(),
            full.len(),
            path_c.as_ptr(),
            200, // 200ms padding
        )
    };

    assert_eq!(ret, 1);
    assert!(temp_file.exists());

    let file_bytes = fs::read(&temp_file).unwrap();
    assert!(file_bytes.len() >= 44 + (8000 * 2));
    assert_eq!(&file_bytes[0..4], b"RIFF");
    assert_eq!(&file_bytes[8..12], b"WAVE");
    assert_eq!(&file_bytes[12..16], b"fmt ");
    assert_eq!(&file_bytes[36..40], b"data");

    // Clean up
    let _ = fs::remove_file(&temp_file);
}

#[test]
fn trim_and_save_wav_with_silence_returns_0_and_does_not_save_file() {
    let temp_file = std::env::temp_dir().join(format!("test_silence_{}.wav", std::process::id()));
    if temp_file.exists() {
        let _ = fs::remove_file(&temp_file);
    }

    let silence = vec![0i16; 16000];
    let path_c = CString::new(temp_file.to_str().unwrap()).unwrap();

    let ret = unsafe {
        vn_audio_trim_and_save_wav(silence.as_ptr(), silence.len(), path_c.as_ptr(), 200)
    };

    assert_eq!(ret, 0);
    assert!(!temp_file.exists());
}

#[test]
fn trim_and_save_wav_null_checks_and_error_codes() {
    let temp_file = std::env::temp_dir().join(format!("test_err_{}.wav", std::process::id()));
    let path_c = CString::new(temp_file.to_str().unwrap()).unwrap();
    let pcm = vec![1000i16; 160];

    // Null output path
    let ret_null_path =
        unsafe { vn_audio_trim_and_save_wav(pcm.as_ptr(), pcm.len(), std::ptr::null(), 200) };
    assert_eq!(ret_null_path, -(VnErrorCode::Unknown as i32));

    // Null pcm pointer with sample_count > 0
    let ret_null_pcm =
        unsafe { vn_audio_trim_and_save_wav(std::ptr::null(), pcm.len(), path_c.as_ptr(), 200) };
    assert_eq!(ret_null_pcm, -(VnErrorCode::AudioRecordFailed as i32));

    // Empty sample_count returns 0
    let ret_empty = unsafe { vn_audio_trim_and_save_wav(pcm.as_ptr(), 0, path_c.as_ptr(), 200) };
    assert_eq!(ret_empty, 0);

    // Invalid non-existent directory path
    let bad_path = CString::new("/nonexistent_dir_12345/voicenote_out.wav").unwrap();
    let speech = vec![12000i16; 4800];
    let ret_bad_path = unsafe {
        vn_audio_trim_and_save_wav(speech.as_ptr(), speech.len(), bad_path.as_ptr(), 200)
    };
    assert!(ret_bad_path < 0);
}
