# VoiceNote — Product Requirements Document (PRD)

## Overview
VoiceNote is a fully offline, privacy-first mobile application that converts speech to text and rewrites it into a chosen tone (Professional or Casual).

## Target Platforms
- iOS 16+ (Bare React Native)
- Android 10+ (API 29+, Bare React Native)

## Core Pipeline
1. **Audio Capture**: Microphone input stream (16 kHz mono PCM)
2. **VAD (Voice Activity Detection)**: WebRTC VAD (`react-native-nitro-webrtc-vad`) for silence detection & auto-stop
3. **ASR (Automated Speech Recognition)**: On-device Whisper (`whisper.rn` / `react-native-sherpa-onnx`) supporting English (en), Hindi (hi), and Hinglish (code-switched)
4. **Tone SLM**: On-device Small Language Model (`llama.rn` with Q4_K_M quant) rewriting raw transcripts into `professional` or `casual` tone
5. **UI Presentation**: Clean, responsive transcription display with one-tap copy and tone switching

## Non-Negotiable Constraints
- **Zero Cloud Inference**: 100% offline inference. No audio, transcript, or rewritten text leaves the device.
- **Zero Telemetry**: No third-party analytics, crash reporting, or tracking SDKs.
- **Immediate Audio Cleanup**: Audio temporary files are deleted immediately after ASR finishes.
- **Off-Main-Thread Execution**: All ML processing runs on native worker threads or JSI isolates.
- **On-Demand Model Provisioning**: Models are downloaded after installation via user action, not bundled into binary.
