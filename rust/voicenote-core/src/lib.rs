pub mod audio;
pub mod errors;

pub use audio::AudioBuffer;
pub use errors::{VnError, VnErrorCode};

use std::ffi::CString;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn voicenote_core_version() -> *const c_char {
    CString::new("0.1.0").unwrap().into_raw()
}

/// # Safety
///
/// `ptr` must be a pointer previously allocated by Rust (e.g. via `voicenote_core_version`),
/// or null. Calling this on any other pointer causes undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn voicenote_core_version_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(CString::from_raw(ptr));
}
