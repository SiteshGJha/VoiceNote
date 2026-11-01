use std::ffi::CString;
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use voicenote_core::errors::VnErrorCode;
use voicenote_core::model_coordinator::{ActiveModel, ModelCoordinator};
use voicenote_core::slm::llama::LlamaEngine;
use voicenote_core::{vn_slm_generate, vn_slm_response_free};

#[tokio::test]
async fn corrupt_or_missing_gguf_fails_cleanly_without_segfault() {
    // 1. Non-existent file
    let missing_path = Path::new("/tmp/nonexistent_model_voice_note_12345.gguf");
    if missing_path.exists() {
        let _ = std::fs::remove_file(missing_path);
    }
    let res = LlamaEngine::load(missing_path, 2048).await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code(), VnErrorCode::AsrModelMissing);

    // 2. Empty file (0 bytes)
    let empty_path = Path::new("/tmp/corrupt_empty_model.gguf");
    {
        let mut f = std::fs::File::create(empty_path).unwrap();
        f.flush().unwrap();
    }
    let res = LlamaEngine::load(empty_path, 2048).await;
    let _ = std::fs::remove_file(empty_path);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code(), VnErrorCode::AsrModelMissing);

    // 3. Invalid magic bytes
    let bad_magic_path = Path::new("/tmp/corrupt_bad_magic.gguf");
    {
        let mut f = std::fs::File::create(bad_magic_path).unwrap();
        f.write_all(b"NOT_GGUF_HEADER_DATA_HERE_1234").unwrap();
        f.flush().unwrap();
    }
    let res = LlamaEngine::load(bad_magic_path, 2048).await;
    let _ = std::fs::remove_file(bad_magic_path);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code(), VnErrorCode::AsrModelMissing);

    // 4. Truncated header (< 24 bytes)
    let truncated_path = Path::new("/tmp/corrupt_truncated.gguf");
    {
        let mut f = std::fs::File::create(truncated_path).unwrap();
        f.write_all(b"GGUF\x03\x00").unwrap();
        f.flush().unwrap();
    }
    let res = LlamaEngine::load(truncated_path, 2048).await;
    let _ = std::fs::remove_file(truncated_path);
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code(), VnErrorCode::AsrModelMissing);
}

#[tokio::test]
async fn valid_gguf_header_loads_successfully() {
    let valid_path = Path::new("/tmp/valid_header_model.gguf");
    {
        let mut f = std::fs::File::create(valid_path).unwrap();
        // GGUF magic (4 bytes): b"GGUF"
        f.write_all(b"GGUF").unwrap();
        // Version (u32 little-endian): 3
        f.write_all(&3u32.to_le_bytes()).unwrap();
        // Tensor count (u64 little-endian): 0
        f.write_all(&0u64.to_le_bytes()).unwrap();
        // Metadata KV count (u64 little-endian): 0
        f.write_all(&0u64.to_le_bytes()).unwrap();
        f.flush().unwrap();
    }

    let engine_res = LlamaEngine::load(valid_path, 2048).await;
    let _ = std::fs::remove_file(valid_path);
    assert!(engine_res.is_ok(), "Engine should successfully load valid GGUF header");
    let engine = engine_res.unwrap();
    assert_eq!(engine.context_size(), 2048);
}

#[tokio::test]
async fn model_coordinator_enforces_mutual_exclusion() {
    let coordinator = ModelCoordinator::new();

    // Initial state: None
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::None);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Whisper).await);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Request Whisper
    coordinator
        .request_subsystem(ActiveModel::Whisper, Some("/path/to/whisper.bin"))
        .await
        .unwrap();
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::Whisper);
    assert!(coordinator.is_subsystem_active(ActiveModel::Whisper).await);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Request Llama -> Whisper MUST be unloaded
    coordinator
        .request_subsystem(ActiveModel::Llama, Some("/path/to/llama.gguf"))
        .await
        .unwrap();
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::Llama);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Whisper).await);
    assert!(coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Request Whisper again -> Llama MUST be unloaded
    coordinator
        .request_subsystem(ActiveModel::Whisper, Some("/path/to/whisper.bin"))
        .await
        .unwrap();
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::Whisper);
    assert!(coordinator.is_subsystem_active(ActiveModel::Whisper).await);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Unload all
    coordinator.unload_all().await;
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::None);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Whisper).await);
    assert!(!coordinator.is_subsystem_active(ActiveModel::Llama).await);
}

#[tokio::test]
async fn model_coordinator_idle_auto_unload() {
    // 50ms idle timeout for testing
    let coordinator = ModelCoordinator::with_idle_timeout(Duration::from_millis(50));
    coordinator
        .request_subsystem(ActiveModel::Llama, Some("/path/to/llama.gguf"))
        .await
        .unwrap();

    assert!(coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Before timeout, should not unload
    let unloaded = coordinator.check_idle_timeout().await;
    assert!(!unloaded);
    assert!(coordinator.is_subsystem_active(ActiveModel::Llama).await);

    // Sleep past 50ms
    tokio::time::sleep(Duration::from_millis(70)).await;

    // After timeout, check_idle_timeout should unload
    let unloaded = coordinator.check_idle_timeout().await;
    assert!(unloaded);
    assert_eq!(coordinator.active_subsystem().await, ActiveModel::None);
}

#[tokio::test]
async fn llama_engine_generate_timeout() {
    let engine = LlamaEngine::dummy_for_testing();
    // Test that a 0ms / 1ms timeout with heavy generation or simulated delay triggers SlmTimeout
    let res = engine
        .generate_with_simulated_delay(
            "Rewrite this text into professional tone",
            0.7,
            0.9,
            128,
            10,  // 10ms timeout
            100, // 100ms simulated execution delay
        )
        .await;

    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code(), VnErrorCode::SlmTimeout);
}

#[tokio::test]
async fn llama_engine_generate_produces_rewrite() {
    let engine = LlamaEngine::dummy_for_testing();
    let prompt = "Instruction: Rewrite in professional tone.\nInput: um yeah we should like meet tomorrow\nOutput:";
    let res = engine.generate(prompt, 0.7, 0.9, 128, 5000).await;
    assert!(res.is_ok());
    let output = res.unwrap();
    assert!(!output.contains("um"));
    assert!(!output.contains("like"));
    assert!(output.contains("meet tomorrow"));
}

#[test]
fn test_vn_slm_generate_null_prompt_returns_error() {
    let model_path = CString::new("/tmp/some_model.gguf").unwrap();
    let resp = unsafe {
        vn_slm_generate(
            std::ptr::null(),
            model_path.as_ptr(),
            0.7,
            0.9,
            128,
            1000,
        )
    };
    assert!(!resp.is_null());
    unsafe {
        assert!((*resp).status < 0);
        assert!((*resp).text.is_null());
        vn_slm_response_free(resp);
    }
}

#[test]
fn test_vn_slm_generate_null_model_path_returns_model_missing() {
    let prompt = CString::new("Input: hello\nOutput:").unwrap();
    let resp = unsafe {
        vn_slm_generate(
            prompt.as_ptr(),
            std::ptr::null(),
            0.7,
            0.9,
            128,
            1000,
        )
    };
    assert!(!resp.is_null());
    unsafe {
        assert_eq!((*resp).status, -(VnErrorCode::AsrModelMissing as i32));
        assert!((*resp).text.is_null());
        vn_slm_response_free(resp);
    }
}

#[test]
fn test_vn_slm_generate_missing_model_file_returns_model_missing() {
    let prompt = CString::new("Input: hello\nOutput:").unwrap();
    let model_path = CString::new("/tmp/missing_file_xyz_123.gguf").unwrap();
    let resp = unsafe {
        vn_slm_generate(
            prompt.as_ptr(),
            model_path.as_ptr(),
            0.7,
            0.9,
            128,
            1000,
        )
    };
    assert!(!resp.is_null());
    unsafe {
        assert_eq!((*resp).status, -(VnErrorCode::AsrModelMissing as i32));
        assert!((*resp).text.is_null());
        vn_slm_response_free(resp);
    }
}

#[test]
fn test_vn_slm_generate_valid_model_rewrites_text() {
    let valid_path = Path::new("/tmp/valid_slm_c_abi_model.gguf");
    {
        let mut f = std::fs::File::create(valid_path).unwrap();
        f.write_all(b"GGUF").unwrap();
        f.write_all(&3u32.to_le_bytes()).unwrap();
        f.write_all(&0u64.to_le_bytes()).unwrap();
        f.write_all(&0u64.to_le_bytes()).unwrap();
        f.flush().unwrap();
    }

    let prompt = CString::new("Instruction: Rewrite in professional tone.\nInput: um yeah we should like meet tomorrow\nOutput:").unwrap();
    let model_path = CString::new(valid_path.to_str().unwrap()).unwrap();
    let resp = unsafe {
        vn_slm_generate(
            prompt.as_ptr(),
            model_path.as_ptr(),
            0.7,
            0.9,
            128,
            5000,
        )
    };
    let _ = std::fs::remove_file(valid_path);

    assert!(!resp.is_null());
    unsafe {
        assert_eq!((*resp).status, 0);
        assert!(!(*resp).text.is_null());
        let text_c = std::ffi::CStr::from_ptr((*resp).text).to_str().unwrap();
        assert!(!text_c.contains("um"));
        assert!(!text_c.contains("like"));
        assert!(text_c.contains("meet tomorrow"));
        vn_slm_response_free(resp);
    }
}
