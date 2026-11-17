# Persistent On-Disk Model Management & macOS Cold-Start Reconciliation

* **Author:** Antigravity
* **Date:** 2026-11-16

## Overview

VoiceNote operates as an offline, privacy-first dictation tool converting speech to text and rewriting tones on-device. On macOS desktop, cold-starting the app currently loses all awareness of installed models, repeatedly prompting users to re-download 639 MB of model weights on every launch.

This design establishes a reliable on-disk physical manifest and cold-start disk reconciliation system for macOS desktop. It ensures model files stored in `~/.voicenote/models` persist across restarts, validates existing model weights on launch, and restores registered status without requiring network downloads.

## Analysis

Synthesis from the multi-lens Goldfish review identifies the root causes, operational risks, and system requirements:

### 1. Root Causes in Codebase
* **In-Memory Filesystem Shim**: Under React Native Metro bundling, Node's `fs` is mapped to `src/shims/fs.js`. Calls to `fs.writeFileSync` store data in an in-memory `Map` (`memFiles`), which evaporates when the macOS process exits.
* **Polyfill Path Mismatch**: `installer.ts` calculates model directories using `path.join(os.homedir(), '.voicenote', 'models')`. Under `os-browserify`, `os.homedir()` returns `'/'`, resolving to the protected root partition `'/.voicenote/models'`. Conversely, native Objective-C++ code in `AppDelegate.mm` expects `~/.voicenote/models` (`NSHomeDirectory()`).
* **Missing Native File I/O Primitives**: `VoiceNoteNativeAudio` provides audio recording and file downloading, but lacks basic physical text file reading, writing, and directory listing primitives.

### 2. Operational Risks & Edge Cases
* **Cold-Start Latency & Main-Thread Blocking**: Synchronous SHA-256 verification of 639 MB of model weights (Whisper 148 MB + Qwen 491 MB) on every launch would introduce 300–800 ms of disk I/O latency, causing UI lag or beachballing.
* **Startup Race Condition (Modal Flashing)**: Evaluating `isProvisioned()` synchronously before asynchronous disk reconciliation finishes causes false negatives. This can flash the `FirstRunSetupModal` or trigger download prompts if the user interacts immediately upon launch.
* **Corrupt Weights Handling**: If an existing file on disk fails SHA-256 integrity, deleting it without explanation confuses the user. The app must distinguish between missing models, verifying models, and corrupt weights requiring targeted re-download.

### 3. Architecture for Resolution
* **Native Physical File Bridge**: Expose 5 discrete, atomic native file I/O methods in `VoiceNoteNativeAudio` (`AppDelegate.mm`): `getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, and `listDirectory`.
* **Two-Tier Cold-Start Verification**:
  - **Tier 1 (Manifest Hit / Fast Path)**: If `~/.voicenote/models/installed_models.json` exists on disk and references files with matching byte sizes, complete registration instantly (< 5 ms) so the UI is immediately ready.
  - **Tier 2 (Manifest Miss / Deep Reconciliation)**: If the manifest is absent or damaged, asynchronously scan `~/.voicenote/models/asr/` and `~/.voicenote/models/slm/`. Match filenames against `MODEL_CATALOG`, run native SHA-256 checksums, generate a fresh manifest, and register engines.
* **Single-Flight Initialization Mutex**: Guard `modelInstaller.initialize()` so concurrent callers in `App.tsx` and `HomeScreen.tsx` share a single background reconciliation promise without duplicate disk reads.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Standardize model directory paths to `~/.voicenote/models` consistently across JavaScript and macOS native Objective-C/C++ runtimes.
  - Expose atomic native physical file reading and writing in `VoiceNoteNativeAudio` and `nativeAudio.ts`.
  - Persist model metadata in `~/.voicenote/models/installed_models.json` via real on-disk writes.
  - Implement cold-start disk reconciliation with two-tier verification (fast path for valid manifest, deep checksum path for raw `.gguf` files).
  - Add an asynchronous startup initialization gate in `App.tsx` and `HomeScreen.tsx` to prevent modal flashing.
  - Preserve 100% offline functionality without any network calls when model weights already exist on disk.

* **Out-of-Scope Non-Goals:**
  - Bundling 639 MB of model weights directly into the macOS application bundle or installer DMG (violates core project constraint against bundling weights in binary).
  - Modifying Whisper or Llama inference runtimes or model quantization schemes.
  - Introducing third-party npm packages (e.g., `react-native-fs`).

## Alternatives Weighed

* **In-Memory MMKV Persistence Alone:**
  - *Rejected:* Does not produce physical JSON files on disk. External tools, scripts, or debuggers cannot inspect installed models outside the app runtime.
* **Stateless Dynamic Scanning on Every Startup (No Manifest):**
  - *Rejected:* Scanning and hashing on every boot introduces disk latency, cannot store original installation timestamps or custom metadata, and wastes CPU cycles.
* **Synchronous Native Hashing on Launch:**
  - *Rejected:* Reading 639 MB off disk on the main thread freezes the macOS UI. Two-tier verification isolates deep hashing to manifest misses.

## Key Decisions & Staging for Next Steps

1. **Native File I/O Bridge (`macos/voicenote-macOS/AppDelegate.mm`)**:
   Implement `getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, and `listDirectory` in `VoiceNoteNativeAudio` using atomic file writing (`writeToFile:atomically:YES`).
2. **TypeScript Native Wrapper (`src/native/nativeAudio.ts`)**:
   Expose typed methods with Jest test environment fallbacks so test suites execute cleanly in Node.
3. **Model Installer Engine (`src/services/modelManager/installer.ts`)**:
   - Replace in-memory `fs` calls with native bridge calls when native audio is present.
   - Implement `initialize(): Promise<void>` supporting both fast-path manifest reads and raw file reconciliation.
   - Protect cold-start reconciliation with single-flight mutex.
4. **UI Initialization Gate (`src/screens/HomeScreen.tsx` & `App.tsx`)**:
   Await `modelInstaller.initialize()` prior to querying `isProvisioned()` to eliminate modal flickering.
5. **Automated Verification**:
   Create `tests/modelInstaller.reconciliation.test.ts` testing cold-start reconciliation, corrupt checksum handling, and manifest survival across restarts.
