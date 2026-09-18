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
