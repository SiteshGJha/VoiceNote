use std::ffi::CStr;
use voicenote_core::{voicenote_core_version, voicenote_core_version_free, VnErrorCode};

#[test]
fn test_version_string_and_free() {
    let ptr = voicenote_core_version();
    assert!(!ptr.is_null());
    let c_str = unsafe { CStr::from_ptr(ptr) };
    assert_eq!(c_str.to_str().unwrap(), "1.0.0");
    unsafe {
        voicenote_core_version_free(ptr as *mut _);
    }
}

#[test]
fn test_error_code_mappings() {
    assert_eq!(VnErrorCode::AsrEmptyOutput as i32, 101);
    assert_eq!(VnErrorCode::AsrTimeout as i32, 102);
    assert_eq!(VnErrorCode::AsrModelMissing as i32, 103);
    assert_eq!(VnErrorCode::SlmTimeout as i32, 201);
    assert_eq!(VnErrorCode::SlmHallucinationSuspected as i32, 202);
    assert_eq!(VnErrorCode::ModelChecksumFailed as i32, 301);
    assert_eq!(VnErrorCode::AudioRecordFailed as i32, 401);
    assert_eq!(VnErrorCode::VadNoSpeech as i32, 501);
    assert_eq!(VnErrorCode::SegmentMergeFailed as i32, 601);
    assert_eq!(VnErrorCode::RecordingLimitReached as i32, 602);
    assert_eq!(VnErrorCode::HardwareTriggerDenied as i32, 603);
    assert_eq!(VnErrorCode::StorageFull as i32, 701);
    assert_eq!(VnErrorCode::Unknown as i32, 999);
}
