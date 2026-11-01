use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use ring::digest::{Context, SHA256};
use crate::errors::{VnError, VnErrorCode};

const CHUNK_SIZE: usize = 65536; // 64 KB

/// Computes the SHA-256 digest of the given file in 64 KB chunks and compares it
/// against `expected_hex` (case-insensitively).
///
/// Returns:
/// - `Ok(true)` if digest matches `expected_hex`.
/// - `Ok(false)` if digest differs from `expected_hex`.
/// - `Err(VnError)` if the file does not exist or an I/O error occurs.
pub fn verify_file_sha256(file_path: &Path, expected_hex: &str) -> Result<bool, VnError> {
    if !file_path.exists() {
        return Err(VnError::new(
            VnErrorCode::AsrModelMissing,
            format!("File not found: {:?}", file_path),
        ));
    }

    let file = File::open(file_path).map_err(|e| {
        VnError::new(
            VnErrorCode::ModelChecksumFailed,
            format!("Failed to open file {:?}: {}", file_path, e),
        )
    })?;

    let mut reader = BufReader::with_capacity(CHUNK_SIZE, file);
    let mut context = Context::new(&SHA256);
    let mut buffer = [0u8; CHUNK_SIZE];

    loop {
        let count = reader.read(&mut buffer).map_err(|e| {
            VnError::new(
                VnErrorCode::ModelChecksumFailed,
                format!("Failed to read file {:?}: {}", file_path, e),
            )
        })?;
        if count == 0 {
            break;
        }
        context.update(&buffer[..count]);
    }

    let digest = context.finish();
    let actual_hex = hex_encode(digest.as_ref());

    Ok(actual_hex.eq_ignore_ascii_case(expected_hex.trim()))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        use std::fmt::Write;
        write!(s, "{:02x}", b).unwrap();
    }
    s
}
