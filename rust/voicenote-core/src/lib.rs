pub mod errors;
pub use errors::{VnError, VnErrorCode};

use std::ffi::CString;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn voicenote_core_version() -> *const c_char {
    CString::new("0.1.0").unwrap().into_raw()
}

#[no_mangle]
pub extern "C" fn voicenote_core_version_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(ptr));
    }
}
