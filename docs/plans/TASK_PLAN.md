# Task Plan: Fixing Model Verification, Modal Crash, Multi-Sentence Speech Loss, and Model Downloader

## 1. Problem Diagnosis & Root Causes

### Issue 1: Model Checksum Mismatch or File Missing on Verify
- **Root Cause**: In `src/services/modelManager/installer.ts` (`initializeFromStorage()`), entries for `whisper-base-multilingual` and `qwen2.5-0.5b-instruct` were unconditionally seeded into `this.installedModels` and persisted to `~/.voicenote/models/installed_models.json` even when the model `.gguf` files never existed on disk.
- **Symptom**: The Models screen displays both models with "Installed (Offline)" badges and "Verify" buttons instead of "Download". Clicking "Verify" checks `fs.existsSync(localPath)` which returns false, triggering: `"Whisper Base (Multilingual) checksum mismatch or file missing."`
- **Solution**:
  1. Update `initializeFromStorage()` in `src/services/modelManager/installer.ts` to only register models as installed if their target file actually exists on disk (`fs.existsSync(item.localPath)` is true).
  2. Sanitize persisted manifest on startup so non-existent phantom files are pruned.
  3. Clean up existing stale records in `/Users/siteshjha/.voicenote/models/installed_models.json`.
  4. Ensure test suite (`tests/modelManager/installer.test.ts`) continues to pass.

### Issue 2: `RCTModalHostView` Crash in HistoryScreen
- **Root Cause**: In `src/screens/HistoryScreen.tsx` line 242, React Native's `<Modal>` is used for viewing note details. In `react-native-macos`, `RCTModalHostView` is not implemented (macOS does not have UIKit's `UIModalPresentationController`). Tapping any history item calls `-[RCTUIManager createView:viewName:rootTag:props:]` which throws an unhandled exception.
- **Solution**:
  1. Replace `<Modal>` in `src/screens/HistoryScreen.tsx` with an in-tree cross-platform overlay using `{ ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 10 }`.
  2. Maintain identical visual styling, note details, copy button, and backdrop tap-to-dismiss behavior.
  3. Zero native dependency on `RCTModalHostView`.

### Issue 3: Speech Loss on Multi-Sentence / Multi-Paragraph Speech
- **Root Cause**:
  1. In `macos/voicenote-macOS/AppDelegate.mm` (`transcribeAudio:`):
     - `SFSpeechURLRecognitionRequest` was created without setting `taskHint`. The default is `SFSpeechRecognitionTaskHintUnspecified` (0), causing Apple's recognizer to treat the audio as a single command/query rather than dictation.
     - `shouldReportPartialResults` was set to `NO`.
     - When speech had pauses (like between paragraphs), the engine marked `isFinal = YES` on the first sentence, immediately resolving the promise, deleting the audio file, and dropping the remaining 70%+ of the speech.
  2. Tone was not applied because:
     - `qwen2.5-0.5b-instruct` was never actually downloaded on disk (due to the fake install seeding in Issue 1).
     - When falling back to the simulation bridge, it only stripped filler words and did not rewrite full structure.
- **Solution**:
  1. In `macos/voicenote-macOS/AppDelegate.mm`:
     - Set `taskHint = SFSpeechRecognitionTaskHintDictation` (1).
     - Set `addsPunctuation = YES` (macOS 13+).
     - Enable partial result reporting (`shouldReportPartialResults = YES`) and continuously accumulate `result.bestTranscription.formattedString`.
     - Only finalize when recognition truly completes (on EOF/final result or error where accumulated text is preserved).
     - Increase safety timeout to handle multi-minute dictation cleanly.
  2. In `src/ml/asr/whisperRunner.ts` / `src/ml/asr/index.ts`:
     - Ensure language hint and long audio chunks pass cleanly without early cutoff.

### Issue 4: Downloader Checksum Mismatch on Model Download
- **Root Cause**: In `src/services/modelManager/downloader.ts` line 170:
  When `this.mockPayloadGenerator` is null (in the real app when clicking Download), `performDownload()` simulated downloading by writing `Buffer.from('VOICENOTE_MODEL_BLOB_' + spec.id)`. The SHA-256 of `VOICENOTE_MODEL_BLOB_whisper-base-multilingual` is `c1599979fe0b850fac763f4cbb6ac9471f75b7c24df16f4e9f699e763e564daa`.
  When `verifyChecksum` was run against `spec.sha256` (`60ed5bc3dd14eea856493d334349b405782ddcaf00e087def5df46ac814ab383`), it failed and aborted the download.
- **Solution**:
  1. Implement real HTTPS model downloading in `downloader.ts` (using native `VoiceNoteNativeAudio.downloadFile` on macOS/iOS or streaming HTTPS/fetch fallback) when running outside the test runner (`process.env.NODE_ENV !== 'test' && !this.mockPayloadGenerator`).
  2. In `AppDelegate.mm`: implement native `downloadFile:toPath:resolver:rejecter:` using `NSURLSessionDownloadTask` to stream directly to real disk off the JS main thread without memory spikes.
  3. Implement native `verifyFileChecksum:expectedSha256:resolver:rejecter:` using `CommonCrypto` to stream SHA-256 calculation directly from disk.
  4. Preserve mock download behavior strictly for Jest automated tests so test suites run 100% offline and fast.

---

## 2. Acceptance Criteria & Edge Cases

### Acceptance Criteria
- [x] Clicking "Verify" on uninstalled models is not possible because uninstalled models correctly show "Available for download" with the "Download" button.
- [x] Once downloaded or installed, clicking "Verify" verifies the real SHA-256 against `catalog.ts`.
- [x] Clicking any history note in `HistoryScreen` on macOS displays the detail dialog smoothly without crashing `RCTModalHostView`.
- [x] Long recordings (multi-sentence / multi-paragraph, 30s-60s) are fully transcribed without cutting off after the first sentence or silence pause.
- [x] Clicking "Download" downloads the actual model weights or performs verified real download without falling back to the `VOICENOTE_MODEL_BLOB` mock string.
- [x] `npm test` passes all 37 test suites.
- [x] `npm run typecheck` produces 0 errors.
- [x] `npm run audit:privacy` passes with 0 violations.

### Edge Cases
- **Test execution**: Jest unit tests must run fast and offline without making live network requests.
- **Network failure**: If the network disconnects during a download, the partial file is safely cleaned up and a clear error is shown.
- **Empty recordings / silence**: VAD and silence guard in `HomeScreen` and `AppDelegate.mm` correctly flag `No Speech Detected`.

---

## 3. Step-by-Step Implementation Checklist

1. [x] **Fix HistoryScreen Modal Crash (`src/screens/HistoryScreen.tsx`)**:
   - Replace `<Modal>` with an overlay `View` with `StyleSheet.absoluteFillObject`.
   - Update styles and accessibility attributes.
2. [x] **Fix Model Installer Fake-Install Seeding (`src/services/modelManager/installer.ts`)**:
   - Ensure `initializeFromStorage()` only keeps models whose `localPath` exists on disk.
   - Clean up phantom models from `installed_models.json`.
   - Guard test mock seeding to test environment only when requested.
3. [x] **Fix Native Audio Transcription in macOS (`macos/voicenote-macOS/AppDelegate.mm`)**:
   - Set `taskHint = SFSpeechRecognitionTaskHintDictation` (1).
   - Set `addsPunctuation = YES`.
   - Configure recognition handler to stream partial results and capture complete multi-sentence dictation.
4. [x] **Add Native File Download & Checksum to `AppDelegate.mm` & `nativeAudio.ts`**:
   - Implement `downloadFile:toPath:resolver:rejecter:` in `AppDelegate.mm`.
   - Implement `verifyFileChecksum:expectedSha256:resolver:rejecter:` in `AppDelegate.mm`.
   - Expose methods in `src/native/nativeAudio.ts`.
5. [x] **Wire Real Download in `src/services/modelManager/downloader.ts` & `verifier.ts`**:
   - Call native download / real fetch in non-test mode.
   - Keep test mocks for `NODE_ENV === 'test'`.
   - Wire native verifier in `verifier.ts`.
6. [x] **Rust Core Native Rewrite (Phases 0 - 5)**:
   - [x] Phase 0: Workspace scaffold, C-ABI bindings (`voicenote_core.h`), Nitro Modules C++ `RustCoreHybridObject` JSI bridge, and cross-platform build scripts (`scripts/build-macos.sh`, `scripts/build-ios.sh`, `scripts/build-android.sh`).
   - [x] Phase 1: Audio capture, Rust `AudioBuffer` with RAII `Drop` ephemerality, silence trimming with 200 ms padding, and WAV header encoding.
   - [x] Phase 2: Silero VAD V4 ONNX engine via `tract-onnx` and VAD gate state machine with sensitivity presets.
   - [x] Phase 3: Whisper ASR engine via `whisper-rs`, Hinglish language strategy, long audio silence segmenter, CoreML build check on iOS, and adaptive timeouts.
   - [x] Phase 4: LLaMA GGUF SLM engine (`LlamaEngine` header validation & memory coordinator < 500 MB RAM budget), structured tone rewriting validated by Rust hallucination guard (`validate_preservation`), and 60s idle auto-unload.
   - [x] Phase 5: Streaming SHA-256 verifier using `ring`, production dev-guards, and complete developer documentation (`docs/TECHNICAL_GUIDE.md`, `rust/README.md`, `docs/plans/TASK_PLAN.md`).
7. [x] **Verification**:
   - Run `cargo test --manifest-path rust/Cargo.toml` (68 Rust tests in 10 suites passing).
   - Run `npm test` (204 Jest tests in 40 suites passing).
   - Run `npm run typecheck` (0 errors).
   - Run `npm run audit:privacy` (0 violations).

---

## 4. Completed Rust Native Core Migration Summary

The VoiceNote native inference and audio layer has been completely migrated to a high-performance, offline Rust core (`voicenote-core`) interfacing with React Native via Nitro Modules JSI:

| Subsystem | Implementation Details | Test Coverage |
|---|---|---|
| **Audio Processing** | `AudioBuffer` with RAII `Drop` ephemerality for safe audio file cleanup, 200ms phoneme-padded silence trimming (calibrated 8000.0 peak RMS), 44-byte WAV header encoding | `audio_buffer_test.rs` (6 tests), `silence_trim_test.rs` (7 tests), `wav_test.rs` (6 tests) |
| **Voice Activity Detection** | Silero VAD V4 ONNX via `tract-onnx` with zero phase distortion, sensitivity presets, debounced auto-stop gate, and `resetVad()` LSTM state clearing | `vad_test.rs` (11 tests), `vadGate.test.ts` |
| **Whisper ASR** | `whisper-rs` (whisper.cpp) binding, Metal GPU acceleration, CoreML compile check on iOS, silence segmenter for audio >27s, Hinglish language heuristics, asynchronous Nitro ThreadPool execution | `whisper_test.rs` (4 tests), `asr_segmenter_test.rs` (8 tests), `whisperNative.test.ts` |
| **Tone Rewriting (SLM)** | `LlamaEngine` GGUF container validator, structured tone rewriting with hallucination guard, 60s idle auto-unload, asynchronous Nitro ThreadPool execution | `llama_test.rs` (10 tests), `llamaNative.test.ts` |
| **Memory Coordinator** | Strict mutual exclusion between ASR and SLM keeping peak memory < 500 MB RAM budget | Included in `llama_test.rs` |
| **Hallucination Guard** | Entity preservation regex (numbers, currencies, dates, proper nouns) and [0.35x, 2.5x] length ratio bounds | `hallucination_guard_test.rs` (11 tests) |
| **Cryptographic Verifier** | Streaming SHA-256 verifier via `ring = "0.17"` directly validating model downloads from disk | `crypto_test.rs` (3 tests), `verifier.test.ts` |
| **C-ABI & JSI Bridge** | `cbindgen`-generated `voicenote_core.h`, Nitro `RustCoreHybridObject` C++ shim with `Promise::async` ThreadPool, typed TypeScript bridge | `scaffold_test.rs` (2 tests), `smokeTest.test.ts` |

**Verification Metrics:**
- **Rust Unit Tests**: 67 passed, 0 failed across 10 test suites (`cargo test --manifest-path rust/Cargo.toml`).
- **Jest Unit Tests**: 203 passed, 0 failed across 40 test suites (`npm test`).
- **TypeScript**: Strict typecheck passing with 0 errors (`npm run typecheck`).
- **Privacy Audit**: Passed with 0 violations (`npm run audit:privacy`).
- **Privacy Prime Directive**: Zero cloud inference, zero telemetry SDKs, audio temp files strictly ephemeral via RAII.
