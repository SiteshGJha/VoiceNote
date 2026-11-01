# VoiceNote — Product Requirements Document (PRD)

## Overview
VoiceNote is a fully offline, privacy-first mobile application that converts speech to text and rewrites it into a chosen tone (Professional or Casual) using an on-device native Rust engine (`voicenote-core`) interfaced through Nitro Modules JSI.

## Target Platforms
- macOS 13+ (Universal arm64 / x86_64, bare desktop workflow)
- iOS 16+ (Bare React Native, arm64 device + simulator)
- Android 10+ (API 29+, Bare React Native, arm64-v8a)

## Core Pipeline & Engine Architecture
1. **Audio Capture**: Microphone input stream (16 kHz / 16-bit / mono PCM) managed via Rust `AudioBuffer` with RAII `Drop` temporary file ephemerality.
2. **VAD (Voice Activity Detection)**: On-device Silero V4 ONNX model (`tract-onnx`) with Low, Medium, and High sensitivity presets and debounced state machine auto-stop (1000–2000 ms).
3. **Silence Trimming**: Phoneme-preserving silence trimmer keeping 200 ms margins and short-circuiting downstream ML on silent recordings.
4. **ASR (Automated Speech Recognition)**: On-device Whisper engine (`whisper-rs` / whisper.cpp with Metal GPU acceleration and CoreML build alert) supporting English (en), Hindi (hi), and Hinglish (code-switched), featuring >27s silence-based segmentation.
5. **Tone SLM & Hallucination Guard**: On-device Small Language Model with `ModelCoordinator` (< 500 MB RAM budget mutual exclusion) and regex-based critical entity preservation.
6. **Cryptographic Model Verification**: Streaming SHA-256 verifier (`ring = "0.17"`) for zero-copy model weight integrity checks.
7. **UI Presentation**: Clean, responsive transcription display with one-tap copy, editable text, instant re-rewriting, and encrypted history.

## Non-Negotiable Constraints
- **Zero Cloud Inference**: 100% offline inference. No audio, transcript, or rewritten text leaves the physical device.
- **Zero Telemetry**: No third-party analytics, crash reporting, or tracking SDKs.
- **Immediate Audio Cleanup**: Audio temporary files are deleted immediately after ASR finishes via Rust `Drop` semantics.
- **Off-Main-Thread Execution**: All heavy ML processing runs asynchronously on Nitro Modules' background `ThreadPool` off the React Native UI thread.
- **Peak RAM Budget**: < 500 MB memory ceiling guaranteed by `ModelCoordinator` mutual exclusion.
- **On-Demand Model Provisioning**: Models are downloaded after installation via user action and checksum-verified, not bundled into binary.
