# VoiceNote — Product Requirements Document (PRD)

## Overview
VoiceNote is a fully offline, privacy-first mobile and desktop application that converts speech to text and rewrites it into a chosen tone (Professional or Casual) using an on-device native Rust engine (`voicenote-core`) interfaced through Nitro Modules JSI.

## Target Platforms
- **macOS Desktop**: macOS 13+ (Universal `arm64` Apple Silicon & `x86_64` Intel, standalone `.dmg` installer)
- **iOS Mobile**: iOS 16+ (Bare React Native, `arm64` physical device & simulator)
- **Android Mobile**: Android 10+ (API 29+, Bare React Native, `arm64-v8a`, standalone signed `.apk` installer)

## Core Pipeline & Engine Architecture
1. **Audio Capture**: Microphone input stream (16 kHz / 16-bit / mono linear PCM) managed via Rust `AudioBuffer` with RAII `Drop` temporary file ephemerality.
2. **VAD (Voice Activity Detection)**: On-device Silero V4 ONNX model (`tract-onnx`) with Low, Medium, and High sensitivity presets and debounced state machine auto-stop (1000–2000 ms).
3. **Silence Trimming**: Phoneme-preserving silence trimmer keeping 200 ms margins and short-circuiting downstream ML on silent recordings.
4. **ASR (Automated Speech Recognition)**: On-device Whisper engine (`whisper-rs` / whisper.cpp with Metal GPU acceleration and CoreML build alert) supporting English (en), Hindi (hi), and Hinglish (code-switched), featuring >27s silence-based segmentation.
5. **Continuous 5-Minute Live Rolling Pipeline**: Silence-bounded audio chunking (20–25s slices) with background FIFO Whisper ASR queue and seam conditioning prompt injection, bounded by a 5-minute (300s) native safety ceiling.
6. **Tone SLM & Hallucination Guard**: On-device Small Language Model (GGUF via `LlamaEngine`) with `ModelCoordinator` (< 500 MB RAM budget mutual exclusion) and regex-based critical entity preservation.
7. **Semantic Paragraph Rewriting**: Automatic segmentation of long transcripts into 150–200 word semantic chunks processed sequentially by the SLM to preserve structural coherence and formatting.
8. **Cryptographic Model Verification**: Streaming SHA-256 verifier (`ring = "0.17"`) for zero-copy model weight integrity checks.
9. **UI Presentation & Fast Dictation**: Clean, responsive transcription display with one-tap copy, editable text, instant re-rewriting, encrypted history, live countdown timer (`MM:SS / 05:00`), 4:30 amber warning, and seamless in-place dictation with automatic clipboard copy and unobtrusive toast feedback.
10. **First-Run Provisioning Flow**: In-app setup modal that performs disk quota checks (>20% headroom) and sequentially downloads and verifies baseline ASR and SLM models before recording is permitted.
11. **Persistent On-Disk Manifest & Two-Tier Cold-Start Reconciliation**: Physical model manifest persistence at `~/.voicenote/models/installed_models.json` via native Objective-C++ file primitives, with Tier 1 Fast Path (< 10 ms startup size verification) and Tier 2 Deep Reconciliation (automatic scanning of `asr/` and `slm/` with SHA-256 validation) eliminating repeated download prompts on app restart.

## Non-Negotiable Constraints
- **Zero Cloud Inference**: 100% offline inference. No audio, transcript, or rewritten text leaves the physical device.
- **Zero Telemetry**: No third-party analytics, crash reporting, or tracking SDKs.
- **Immediate Audio Cleanup**: Audio temporary files are deleted immediately after ASR finishes via Rust `Drop` semantics (Ephemerality Prime Directive).
- **Off-Main-Thread Execution**: All heavy ML processing runs asynchronously on Nitro Modules' background `ThreadPool` off the React Native UI thread.
- **Peak RAM Budget**: < 500 MB memory ceiling guaranteed by `ModelCoordinator` mutual exclusion and 60-second idle auto-unload.
- **On-Demand Model Provisioning**: Models are downloaded after installation via user action and checksum-verified, not bundled into binary.
- **Strict Binary Size Ceiling**: Standalone release installers (`.dmg` and `.apk`) must strictly not exceed **80 MB**. Accidental bundling of ML model weights is actively blocked at build time.

---

## Standalone Distribution & Packaging Specifications

### macOS Universal DMG Packaging (`dist/VoiceNote-1.0.0.dmg`)
- **Binary Architecture**: Universal binary combining Apple Silicon (`aarch64-apple-darwin`) and Intel (`x86_64-apple-darwin`) compiled via Apple `lipo` into `macos/build/rust/libvoicenote_core.a`.
- **Bundling & Toolchain**: Headless release compilation using `xcodebuild archive`, embedded offline JavaScript bundle (`main.jsbundle`), and staged intermediate `dmg-root/` structure containing `VoiceNote.app` and `/Applications` symlink.
- **Codesigning**: Inside-out ad-hoc codesigning (`codesign --force --deep --sign -`) signing nested frameworks in `Contents/Frameworks/` before the top-level bundle.
- **Disk Image Layout**: Clean volume generated via `create-dmg` (with fallback to `hdiutil`) with size ceiling verification (< 80 MB).

### Standalone Signed Android Release APK (`dist/VoiceNote-1.0.0-arm64-v8a.apk`)
- **Target Architecture**: Android 10+ (API 29+), `arm64-v8a` ABI.
- **Project Structure**: Modern React Native 0.76 Gradle/NDK build tree (`AGP 8.5.2`, `Kotlin 1.9.24`, `Gradle 8.8`) with Hermes engine enabled.
- **Native JNI Integration**: Direct Rust JNI bridge (`rust/voicenote-core/src/android_jni.rs` compiled to `libvoicenote_core.so` via `cargo ndk`) exposing silence trimming, checksum verification, and Whisper transcription.
- **Release Signing**: Automated keystore provisioning (`scripts/generate-android-keystore.sh`) with environment variable overrides (`VN_KEYSTORE_PATH`, `VN_KEYSTORE_PASSWORD`, `VN_KEY_ALIAS`, `VN_KEY_PASSWORD`) and cryptographic `apksigner verify` validation.
- **Package Ceiling**: Strict assertion verifying the compiled APK does not exceed 80 MB.
