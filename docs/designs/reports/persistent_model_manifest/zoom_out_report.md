# Stage 5 Initial Zoom Out Review: Persistent On-Disk Model Management & macOS Cold-Start Reconciliation

* **Target Document:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md` (Lines 1–332)
* **Reviewer:** Skeptical Architect (`egm-zoom-out`)
* **Status:** **REJECT / RE-ARCHITECT (Over-Engineered & YAGNI Violations)**
* **Date:** 2026-11-17

---

## Executive Summary

The proposal correctly diagnoses two genuine bugs on macOS:
1. `os.homedir()` returns `"/"` in React Native's browser polyfill, generating an invalid target path (`/.voicenote/models`).
2. `installer.ts` relies on Node `fs`, which routes to an in-memory Map mock (`src/shims/fs.js`) in React Native, discarding installation status on process exit.

However, the proposed architectural remedy introduces substantial over-engineering:
1. **Reinventing a Mini Filesystem**: Proposes 5 custom native file I/O primitives (`readTextFile`, `writeTextFile`, `fileExists`, `listDirectory`, `getModelsDirectory`) in `VoiceNoteNativeAudio` in `AppDelegate.mm` to serialize a tiny JSON object, turning the audio bridge into a generic filesystem dumping ground.
2. **YAGNI Deep Reconciliation**: Invents a dynamic directory scanner, regex matcher, and cold-start SHA-256 rehashing engine for a speculative edge case (valid weights exist, but manifest is missing). Furthermore, the app only supports two deterministic model paths (`whisper-base-multilingual` and `qwen2.5-0.5b-instruct`), making dynamic directory scanning unnecessary.
3. **Asynchronous Cascade & UI State Poisoning**: Reading the manifest asynchronously over the React Native bridge forces async initialization into the constructor, cascading into single-flight mutexes, UI loading spinners on the record button, and race condition guards. Synchronous MMKV persistence solves this in < 0.1 ms with zero UI disruption.

---

## Findings

### Finding 1: Reinventing a Mini Filesystem in `AppDelegate.mm` (Blocker)
* **Affected Scope:** Section 2 (Lines 113–143), Section 3 (Lines 144–159).
* **Rationale:**
  * **Violates Single Responsibility Principle:** `VoiceNoteNativeAudio` is an audio capture and transcription bridge. Adding general-purpose file I/O primitives turns `AppDelegate.mm` into an architectural catch-all.
  * **Existing Dependency Ignored:** `react-native-mmkv` is already installed and explicitly mandated by `.agents/rules/01-react-native-conventions.md`. MMKV provides synchronous, C++-backed persistence with zero bridge hops, 0 ms startup overhead, and zero custom native Objective-C++ code.
  * **Platform Fragmentation:** Adding these 5 methods to `AppDelegate.mm` does not resolve Android or iOS, creating platform divergence unless all 5 methods are duplicated in Kotlin and Swift.

### Finding 2: Two-Tier Deep Cold-Start Reconciliation is a YAGNI Trap (Blocker)
* **Affected Scope:** Section 1 (Lines 102–107), Section 4 (Lines 160–204), CUJ 2 (Lines 51–55).
* **Rationale:**
  * **Speculative Edge Case:** The deep reconciler is built for the scenario where model files exist on disk, but `installed_models.json` is missing or corrupted. Atomic writes or MMKV eliminate corruption at write time.
  * **Known Deterministic Paths:** The app only supports two catalog models. Their filenames and paths are 100% deterministic (`getModelDestinationSubdir` and `getModelFileName`). Dynamic directory scanning (`listDirectory`) is unnecessary; checking known target paths directly suffices.

### Finding 3: Asynchronous Cascade and UI State Poisoning (Major)
* **Affected Scope:** Section 4 (Lines 160–165), Section 5 (Lines 205–212).
* **Rationale:**
  * Reading the manifest asynchronously over the bridge breaks synchronous constructor initialization.
  * This forces single-flight mutexes, startup hooks in `App.tsx`, `isInitializingModels` state in `HomeScreen.tsx`, and loading spinners on the record button.
  * Synchronous MMKV persistence avoids the async cascade entirely.

### Finding 4: Behavioral Specification Contradiction in Fast Path (Major)
* **Affected Scope:** Section 4 (Lines 174–176, 190–194).
* **Rationale:**
  * The fast path mandates verifying `sizeBytes` of entries before registering.
  * The proposed native primitive is `fileExists(path) -> boolean`, which does not return file size. `src/shims/fs.js` returns dummy stats (`size: 1024`). The proposed primitives cannot perform the specified check.

### Finding 5: Redundant Native Bridge Primitives (Nit)
* **Affected Scope:** Section 1 (Line 106), Section 3 (Line 155).
* **Rationale:**
  * `verifyFileChecksum` already exists in `NativeAudioBridge` (`src/native/nativeAudio.ts` line 126) and `AppDelegate.mm` (line 652).

---

## Minimalist Recommendation

1. **Expose Base Path Only (1 Native Method):**
   * Expose `getModelsDirectory(): Promise<string>` on `NativeAudioBridge` to resolve `~/.voicenote/models/` via `NSHomeDirectory()` or `NSApplicationSupportDirectory`.
2. **Persist Model Registry via MMKV (0 Custom Native File Primitives):**
   * Store installed models in MMKV (`voicenote-models` instance). Model initialization remains 100% synchronous, with zero UI mutexes or record button spinners.
3. **Direct Deterministic Existence Check:**
   * Drop `readTextFile`, `writeTextFile`, and `listDirectory`.
   * For the two known models, verify existence at exact deterministic paths if needed, or rely on existing native load error handling (`ASR_MODEL_MISSING`).
