# VoiceNote — Model Candidates & Bake-Off Results

## 1. VAD Models (Voice Activity Detection)

| Model ID | Engine | Size | Format | RAM | Latency Target | Recommended |
|---|---|---|---|---|---|---|
| `silero-vad-v4` | `tract-onnx` | ~1.8 MB | ONNX | < 10 MB | < 5 ms / frame | Yes (Default on-device) |
| `rms-fallback` | Energy RMS | 0 MB | Native Rust | < 1 MB | < 0.1 ms / frame | Zero-dependency fallback |

## 2. ASR Models (Whisper / whisper-rs)

| Model ID | Arch | Size | Quant | Min RAM | Target Languages | Recommended |
|---|---|---|---|---|---|---|
| `whisper-tiny-multilingual` | Whisper Tiny | ~75 MB | Q5_1 / int8 | 1 GB | English, Hindi | Fast fallback |
| `whisper-base-multilingual` | Whisper Base | ~145 MB | Q5_1 | 2 GB | English, Hindi, Hinglish | Yes (Default) |
| `whisper-small-multilingual` | Whisper Small | ~480 MB | Q4_K_M | 4 GB | English, Hindi | High accuracy |

## 3. Tone Rewriting Models (SLM / GGUF)

| Model ID | Quant | Context | Size | Tok/s Target | Memory Budget | Notes |
|---|---|---|---|---|---|---|
| `qwen2.5-0.5b-instruct` | Q4_K_M | 2048 | ~350 MB | > 20 tok/s | < 450 MB | Lightweight, fast |
| `palmer-005` | Q4_K_M | 2048 | ~380 MB | > 18 tok/s | < 480 MB | Tested for tone shifts |
| `gemma-2-2b-instruct` | Q4_K_M | 2048 | ~1.4 GB | > 10 tok/s | ~1.5 GB | High RAM devices only |

## 4. On-Device Model Memory Management
- **Peak Budget**: Strictly **< 500 MB RAM**.
- **Mutual Exclusion**: Managed via `ModelCoordinator` (`rust/voicenote-core/src/model_coordinator.rs`). Whisper and LLaMA are never concurrently resident in RAM.
- **Idle Unload**: Inactive models are evicted after 60 seconds of inactivity to return the app to baseline memory footprint.
- **Checksum Verification**: Every downloaded model file is verified via streaming SHA-256 (`ring = "0.17"`) in 64 KB chunks prior to registration.

## 5. Bake-Off Records
*Run `/bake-off-slm` to generate benchmark runs and append results here.*
