# Changelog

All notable changes to **VoiceNote** will be documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
