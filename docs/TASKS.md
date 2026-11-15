# VoiceNote — Ordered Task Breakdown

## Phase 1: Project Setup & Architecture
- [x] Initialize bare React Native project with TypeScript strict mode
- [x] Configure Zustand store and encrypted MMKV persistence
- [x] Set up navigation stack (React Navigation)
- [x] Configure native build targets (iOS Swift, Android Kotlin, arm64-v8a / x86_64)

## Phase 2: Audio & VAD
- [x] Integrate audio recording with background worker
- [x] Implement VAD gate (`react-native-nitro-webrtc-vad`) with sensitivity presets (low, medium, high)
- [x] Implement automatic silence trimming and auto-stop
- [x] Add VAD debugging & simulation scripts

## Phase 3: Model Manager
- [x] Implement model catalog and metadata specifications
- [x] Implement resumable HTTPS downloader with SHA-256 integrity verification
- [x] Build model installation, verification, and uninstallation workflows
- [x] Add storage quota and eviction checks

## Phase 4: ASR Pipeline
- [x] Integrate Whisper native runtime (`whisper.rn` / `react-native-sherpa-onnx`)
- [x] Wire 16 kHz audio buffer feeding and language detection (en, hi, auto)
- [x] Implement Hinglish bilingual prompt handling
- [x] Implement Hindi romanization transliteration post-processor
- [x] Add WER benchmark harness against fixture datasets

## Phase 5: SLM Tone Rewriting
- [x] Integrate GGUF runtime (`llama.rn`) with lazy model loading
- [x] Construct canonical prompt templates for Professional and Casual tones
- [x] Implement entity and fact preservation guard (`validatePreservation`)
- [x] Add SLM bake-off evaluation script

## Phase 6: UI & Production Hardening
- [x] Build main recording, transcription, and tone selector screens
- [x] Implement history screen with encrypted storage (max 50 records)
- [x] Enforce off-main-thread inference and UI responsiveness metrics
- [x] Perform release checks and privacy audits

## Phase 7: First-Run Provisioning Flow & In-Place Auto-Copy Dictation
- [x] First-run model provisioning modal with storage headroom validation
- [x] Sequential model download and cryptographic SHA-256 verification
- [x] Explicit sequential Whisper deallocation post-ASR (< 500 MB RAM budget)
- [x] Automatic clipboard copy for rewritten tone output
- [x] In-place toast notification with "View Note" navigation action
- [x] Auto-copy toggle in Settings screen and persistent Zustand store


## Phase 8: 5-Minute Continuous Pipeline (Live Rolling Whisper)
- [x] Silence-bounded rolling audio slicing (20–25s) in native audio bridge (`AppDelegate.mm`)
- [x] Hard 5-minute (300s) native safety ceiling and auto-stop trigger
- [x] Background FIFO Whisper ASR worker with `initialPrompt` seam conditioning
- [x] Immediate post-ASR audio chunk file deletion (Ephemerality Prime Directive)
- [x] Sequential paragraph SLM rewriter (150–200 words) with entity preservation guards
- [x] Sequential Whisper memory deallocation before SLM allocation (< 500 MB RAM budget)
- [x] UI countdown timer (`MM:SS / 05:00`), 4:30 amber warning, and 4:50 countdown banner
- [x] Automated Jest unit test suite covering rolling recorder, FIFO worker, SLM paragraphs, and UI ceiling

## Phase 9: Standalone Android APK & macOS DMG Production Packaging
- [x] Automated pre-flight toolchain validation scripts for macOS (`scripts/build-macos-dmg.sh`) and Android (`scripts/build-android-release.sh`)
- [x] Dual-architecture static Rust compilation (`aarch64` and `x86_64`) with Apple `lipo` fat library merging
- [x] Headless release Xcode archiving and inside-out ad-hoc codesigning (`codesign --force --deep --sign -`)
- [x] Standalone macOS DMG installer packaging with `/Applications` drag-and-drop symlink (`create-dmg` / `hdiutil`)
- [x] Complete React Native 0.76 Android project tree scaffolding (`build.gradle`, `settings.gradle`, `app/build.gradle`, Gradle wrapper 8.8)
- [x] Native Android Kotlin entry points (`MainActivity.kt`, `MainApplication.kt`), ProGuard rules, and XML resources
- [x] JNI cross-compilation bridge (`voicenote_core/src/android_jni.rs` and `AndroidNativeBridge.kt`) via `cargo-ndk` targeting `arm64-v8a`
- [x] Automated development release keystore generator (`scripts/generate-android-keystore.sh`) supporting external CI environment secrets
- [x] Standalone signed release APK assembly via Gradle (`./gradlew assembleRelease`) with cryptographic `apksigner` validation
- [x] Multi-platform packaging orchestrator (`scripts/build-all.sh`) with strict `< 80 MB` installer size ceiling enforcement
