# Changelog

All notable changes to **VoiceNote** will be documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-11-15

### Added
- **Standalone Android Release APK Pipeline (`scripts/build-android-release.sh`)**
  - Cross-compiles `libvoicenote_core.so` targeting `arm64-v8a` (Android API 29+) via `cargo-ndk`.
  - Bootstrapped full React Native 0.76 Gradle/NDK hierarchy (`AGP 8.5.2`, `Kotlin 1.9.24`, `Gradle 8.8`).
  - Implemented Kotlin native module `VoiceNoteNativeAudioModule.kt` matching complete `src/native/nativeAudio.ts` contract (16 kHz PCM recording via `AudioRecord`, live metering calculation, rolling chunk slicing, HTTP redirect following up to 5 hops, and mapped ASR error taxonomy).
  - Implemented JNI C-FFI bridge in `rust/voicenote-core/src/android_jni.rs` with `VoiceNoteCoreJni.kt`.
  - Automatic developer release keystore generator `scripts/generate-android-keystore.sh` supporting CI environment secrets.
  - Dynamic `apksigner` signature verification in build script.
- **Standalone Universal macOS DMG Pipeline (`scripts/build-macos-dmg.sh`)**
  - Compiles dual-architecture static Rust slices (`aarch64-apple-darwin` + `x86_64-apple-darwin`) merged via `lipo` into `macos/build/rust/libvoicenote_core.a`.
  - Offline standalone JavaScript bundling (`main.jsbundle`) and assets packaging.
  - Headless `xcodebuild archive` in Release configuration.
  - Inside-out ad-hoc codesigning with strict bundle verification (`codesign --verify --deep --strict`).
  - Staging into intermediate `dmg-root` volume layout for `/Applications` drag-and-drop.
- **Package Size Ceiling Enforcement (< 80 MB)**
  - Automated hard assertion in build scripts ensuring no Whisper or SLM model weights are accidentally bundled into installer assets.
- **Automated Packaging Sanity Test Suite (`tests/native/packagingSanity.test.ts`)**
  - 33 automated tests validating script existence, executable bits, size limit logic, git hygiene, and scaffolding contracts.
- **Packaging Documentation (`docs/PACKAGING.md`)**
  - Complete guide for prerequisites, build commands, Gatekeeper bypass (`xattr -cr`), and Android sideloading.

## [2.1.0] - 2026-11-08

### Added
- **5-Minute Continuous Speech-to-Text Engine (Live Rolling Whisper)**
  - Native rolling audio capture slicing at silence boundaries (20.0s – 25.0s window, RMS < -36 dBFS for >= 350 ms).
  - Hard 300.0s (5-minute) safety ceiling with automatic trailing chunk sealing and `onCeilingReached` event.
  - Background FIFO Whisper ASR queue (depth cap: 1) conditioning chunk $N$ with trailing 40 chars of chunk $N-1$ via `initialPrompt`.
  - Strict audio ephemerality: temporary chunk audio files deleted immediately post-ASR in `finally` blocks.
  - Sequential paragraph SLM rewriter slicing transcripts into 150–200 word semantic blocks with 8s timeout and entity preservation isolation.
  - Sequential memory mutual exclusion: Whisper deallocation cooldown before SLM allocation (< 500 MB RAM budget).
- **In-Place Dictation UI & Auto-Copy Workflow**
  - `HomeScreen` countdown timer (`MM:SS / 05:00`), amber styling at 4:30 with haptics, and 4:50 warning banner.
  - Automatic clipboard copy of rewritten note upon completion (guarded by active AppState).
  - Unobtrusive Toast notifications with "View Note" navigation action.
  - First-Run model setup modal (`FirstRunSetupModal.tsx`) with storage headroom validation (>20% free disk).

## [2.0.0] - 2026-11-01

### Added
- **Unified Rust Static Library (`voicenote-core`)**
  - High-performance, memory-safe on-device Rust static library (`rust/voicenote-core`) serving macOS, iOS, and Android.
  - Zero-cost C-ABI FFI layer with automatic C header generation via `cbindgen` (`voicenote_core.h`).
  - Full error taxonomy mapping 1:1 between Rust `VnErrorCode` and TypeScript `MlErrorCode`.
  - Comprehensive unit test suite with 68 Rust unit tests across 10 test binaries.

- **Asynchronous Nitro Modules 0.18 JSI Bridge**
  - C++ `RustCoreHybridObject` registering natively with Nitro 0.18's `HybridObjectRegistry`.
  - Asynchronous inference execution via `margelo::nitro::Promise<T>::async` running on Nitro's background `ThreadPool` off the React Native JS UI thread, preventing UI thread stalls and mobile OS watchdog terminations (e.g. iOS `0x8badf00d`).
  - Strict TypeScript interfaces (`IRustCoreHybridObject`) and deterministic Node/Jest mock fallbacks for fast, offline testing.

- **Audio Ephemerality & PCM Pipeline in Rust**
  - `AudioBuffer` implementing RAII `Drop` semantics to guarantee immediate deletion of temporary audio files on completion, abort, or thread termination.
  - Rust-native silence trimming with 200 ms phoneme-preserving padding, calibrated normalized RMS calculation (8,000 peak reference), and silent recording early-exit.
  - Zero-allocation 44-byte RIFF WAVE header serialization (`wrap_pcm_with_wav_header`).

- **On-Device Silero V4 Voice Activity Detection**
  - Silero V4 ONNX model inference running via `tract-onnx` on-device with zero phase distortion.
  - Dynamic model loading with seamless fallback to calibrated RMS energy detection.
  - Debounced state machine (`idle` → `speech` → `silence`) with configurable auto-stop silence window (1000 ms to 2000 ms).
  - Explicit `resetVad()` bridge method clearing recurrent LSTM cell and hidden states across recording sessions.

- **Whisper ASR Engine & Bilingual Heuristics in Rust**
  - Asynchronous speech-to-text engine wrapping `whisper-rs` (whisper.cpp) with Apple Silicon Metal acceleration.
  - Compile-time CoreML check in `build.rs` emitting warnings on iOS builds if CoreML acceleration is missing.
  - Silence-based audio segmenter slicing long audio (> 27 s) at natural silence gaps to avoid Whisper's 30s window cutoff.
  - Hinglish bilingual language strategy biasing Devanagari script for Hindi and Latin letters for English, with short-clip (< 1.5 s) English default heuristic.
  - Duration-adaptive inference timeouts (`3 × audio duration + 15 s`, clamped to [30 s, 120 s]).

- **SLM Engine, Model Coordinator & Hallucination Guard**
  - `ModelCoordinator` enforcing strict mutual exclusion between Whisper and LLaMA in memory, keeping peak RAM strictly under the **< 500 MB** budget.
  - Automatic 60-second idle auto-unload timer reclaiming baseline RAM after periods of inactivity.
  - GGUF container header validation and safety bounds checking (Review Focus 4).
  - Regex-based Rust hallucination guard (`validate_preservation`) verifying critical entities (numbers, currencies, percentages, dates/times, ordinals, proper nouns) and length ratio bounds ([0.35×, 2.5×]).

- **Cryptographic Verification**
  - Zero-copy streaming SHA-256 verifier powered by `ring = "0.17"` (`vn_crypto_verify_sha256`) processing multi-hundred MB model weights in 64 KB buffered chunks.

- **Cross-Platform Compilation Tooling**
  - `scripts/build-macos.sh`: Builds macOS universal static library `libvoicenote_core.a`.
  - `scripts/build-ios.sh`: Builds dual-slice iOS device and simulator `RustCore.xcframework` via `xcodebuild`.
  - `scripts/build-android.sh`: Compiles Android `libvoicenote_core.so` for `arm64-v8a` via `cargo-ndk`.

### Changed
- Replaced legacy simulation shims in `src/native/whisperNative.ts` and `src/native/llamaNative.ts` with direct asynchronous calls to `getRustCore()`.
- Replaced legacy WebRTC VAD adapter in `src/native/webrtcVad.ts` to route audio frames through `getRustCore()?.evalVad()`.
- Replaced simulated file checksum calculation in `src/services/modelManager/verifier.ts` with `getRustCore()?.verifyFileSha256()`.
- Enforced strict production release guards in `src/native/audioWorker.ts` throwing if simulation is attempted in non-dev/non-test builds.
- Updated `src/native/smokeTest.ts` to query real dynamic `RustCore` status and version.

### Removed
- Removed compile-time `include_bytes!` dependency on gitignored `silero_vad.onnx` in favor of dynamic runtime loading with graceful fallback.
- Removed synchronous JSI inference calls that previously risked blocking the React Native UI thread.

## [1.0.0] - 2026-09-12

### Added
- **Audio Capture & VAD (Phases 1 & 2)**
  - 16 kHz 16-bit mono linear PCM / WAV recording pipeline.
  - WebRTC Voice Activity Detection (`VadGate`) with Low, Medium, and High presets.
  - Automatic silence trimming with 200 ms phoneme padding and silence window auto-stop.
  - Real-time animated 60 fps `<Waveform />` level visualizer.
  - Immediate audio file deletion post-ASR ensuring zero audio persistence.

- **Offline Speech-to-Text / ASR (Phase 3)**
  - Local Whisper speech recognition engine with 30s timeout guard and off-thread execution.
  - English, Hindi (हिंदी), and Hinglish (code-switched bilingual prompt tuning).
  - Devanagari and Romanized Hindi transliteration post-processing.
  - Model registry supporting Whisper Tiny, Base, and Small tiers.

- **Tone Rewriting / SLM (Phase 4)**
  - On-device Small Language Model (`llama.rn` GGUF runner) with 10s timeout protection.
  - Canonical prompts for `professional` and `casual` tone transformations.
  - Meaning-preservation validation (`validatePreservation`) preventing hallucinations, dropped entities, or fact modifications.
  - Automatic graceful fallback to raw transcription on rewrite failure or suspected entity drift.

- **Result & History UI (Phases 5 & 6)**
  - `<ResultScreen />` with editable notes, raw vs. rewritten toggle, one-tap clipboard copy, and native OS share sheet.
  - Instant re-rewrite upon tone selection without re-recording.
  - Encrypted history storage backed by OS Keychain encryption key.
  - Strict 50-record FIFO eviction policy, individual deletion, and master wipe.

- **Model Manager & Settings (Phases 7 & 8)**
  - Resumable HTTPS model downloader with SHA-256 integrity verification.
  - `<ModelsScreen />` showing on-device models, download progress, and local storage usage.
  - `<SettingsScreen />` for default tone, language, VAD sensitivity, ASR tier, and dark/light mode appearance.
  - `<PrivacyScreen />` detailing zero-cloud guarantees and technical audit standards.

- **Hardening & Verification (Phases 9 & 10)**
  - Automated privacy audit script (`scripts/privacy-audit.js`) verifying zero unauthorized network calls, zero analytics SDKs, and minimal permissions.
  - Comprehensive Jest automated test suite covering audio WAV math, VAD gating, ASR transcription, SLM preservation, pipeline orchestration, and storage FIFO.
  - Benchmark evaluation harnesses (`scripts/wer.ts`, `scripts/slm-bakeoff.ts`, `scripts/vad-debug.ts`).
