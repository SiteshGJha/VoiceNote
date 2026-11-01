use std::ffi::CString;
use std::io::Write;
use voicenote_core::crypto::sha256::verify_file_sha256;
use voicenote_core::vn_crypto_verify_sha256;

#[test]
fn verify_sha256_accurately_detects_match_and_mismatch() {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(b"voicenote-offline-ml").unwrap();
    // SHA-256 of "voicenote-offline-ml"
    let correct = "d9407f8adb3d2208d2d36ff8bb46971ec142bcd1ca84f28ea9542a3ad3c4ff4f";
    // Exact match
    assert!(verify_file_sha256(file.path(), correct).unwrap());
    // Case-insensitive match
    assert!(verify_file_sha256(file.path(), &correct.to_uppercase()).unwrap());
    // Mismatch
    assert!(!verify_file_sha256(file.path(), "deadbeef0000").unwrap());
}

#[test]
fn verify_sha256_missing_file_returns_error() {
    let res = verify_file_sha256(std::path::Path::new("/nonexistent/file.bin"), "abcdef");
    assert!(res.is_err());
}

#[test]
fn vn_crypto_verify_sha256_c_abi() {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(b"voicenote-offline-ml").unwrap();
    // SHA-256 of "voicenote-offline-ml"
    let correct = "d9407f8adb3d2208d2d36ff8bb46971ec142bcd1ca84f28ea9542a3ad3c4ff4f";

    let path_c = CString::new(file.path().to_str().unwrap()).unwrap();
    let correct_c = CString::new(correct).unwrap();
    let wrong_c = CString::new("deadbeef").unwrap();

    unsafe {
        assert_eq!(vn_crypto_verify_sha256(path_c.as_ptr(), correct_c.as_ptr()), 1);
        assert_eq!(vn_crypto_verify_sha256(path_c.as_ptr(), wrong_c.as_ptr()), 0);
        assert!(vn_crypto_verify_sha256(std::ptr::null(), correct_c.as_ptr()) < 0);
        assert!(vn_crypto_verify_sha256(path_c.as_ptr(), std::ptr::null()) < 0);
        let non_exist_c = CString::new("/nonexistent/file.bin").unwrap();
        assert!(vn_crypto_verify_sha256(non_exist_c.as_ptr(), correct_c.as_ptr()) < 0);
    }
}
