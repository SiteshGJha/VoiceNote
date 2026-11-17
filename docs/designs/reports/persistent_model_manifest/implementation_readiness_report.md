# Stage 9 Implementation Readiness Test Report

* **Target Document:** [`docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L257-L332) (Lines 257–332)
* **Reviewers:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`
* **Synthesis:** `egm-synthesizer`
* **Date:** 2026-11-17

---

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

---

## Severity Breakdown

* 🔴 **Blocker**: 2
* 🟡 **Major**: 4
* 🟢 **Nit**: 2

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Missing Native File Size API / Fast-Path Size Verification Gap (Blocker)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 260–268 (`Target 1: AppDelegate.mm`), Lines 269–275 (`Target 2: nativeAudio.ts`), Lines 280–281 (`Target 3: installer.ts`)
* **Discrepancy Description**:
  Line 281 mandates: *"Implement Tier 1 Fast Path: read `installed_models.json`, check file sizes, and register models in `< 5 ms`"* (and line 175: *"All files present with matching size?"*).
  However, the 5 native methods proposed in `AppDelegate.mm` (lines 263–267) and `NativeAudioBridge` (lines 272) are strictly:
  `getModelsDirectory()`, `readTextFile()`, `writeTextFile()`, `fileExists()`, `listDirectory()`.
  There is NO `getFileSize(filePath)` or `stat(filePath)` method declared. Furthermore, line 192 states: *"2. Parse JSON. For each model entry, call `nativeAudio.fileExists(model.localPath)`"* (which omits size checks).
* **Recommendation**:
  Explicitly resolve the API contract gap:
  1. Add `RCT_EXPORT_METHOD(getFileSize:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)` to `AppDelegate.mm` returning `NSNumber` (via `[[[NSFileManager defaultManager] attributesOfItemAtPath:filePath error:nil] fileSize]`), and add `getFileSize(filePath: string): Promise<number>` to `NativeAudioBridge`.
  2. Update line 281 and line 192 to define whether Tier 1 verifies `manifestModel.sizeBytes === await nativeAudio.getFileSize(manifestModel.localPath)` or relies strictly on `nativeAudio.fileExists(manifestModel.localPath)` to guarantee the `< 5 ms` cold-start budget.

### 2. Undefined Return Semantics, Error Handling, and Parent Directory Creation in Native File Primitives (Blocker)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 260–268 (`Target 1: AppDelegate.mm`)
* **Discrepancy Description**:
  The proposed native methods list shorthand signatures without defined error and return semantics:
  1. `readTextFile`: When `filePath` does not exist, `[NSString stringWithContentsOfFile:encoding:error:]` returns `nil` and sets `error`. If implemented by calling `reject(..., error)`, every cold start with a missing manifest will trigger an unhandled Promise rejection in JavaScript rather than resolving `null` as expected by `readTextFile(filePath: string): Promise<string | null>`.
  2. `writeTextFile`: If intermediate directories (such as `~/.voicenote/models/`) do not yet exist, `[content writeToFile:filePath atomically:YES encoding:NSUTF8StringEncoding error:&error]` fails and returns `NO` unless intermediate parent directories are created first.
  3. `listDirectory`: If `dirPath` does not exist (e.g. `~/.voicenote/models/asr` prior to first download), `contentsOfDirectoryAtPath:error:` returns `nil`. If it rejects, Tier 2 deep reconciliation will throw instead of resolving `@[]`.
  4. Execution Queue: `AppDelegate.mm` specifies `requiresMainQueueSetup` returning `YES`. Long disk reads or directory listings without `dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ...)` risk UI thread stalls.
* **Recommendation**:
  Define explicit Objective-C method declarations and edge-case contracts in Target 1:
  - `readTextFile`: If `!fileExists`, resolve with `[NSNull null]`. Only reject on actual read I/O errors.
  - `writeTextFile`: Explicitly create intermediate parent directories via `[[NSFileManager defaultManager] createDirectoryAtPath:[filePath stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil]` before writing; resolve `@(YES)` on success, reject with error code `FS_WRITE_ERROR` on failure.
  - `listDirectory`: If directory does not exist, resolve with empty array `@[]`.
  - Dispatch file I/O operations to `dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)`.

### 3. Factual Codebase Misalignment in Target 4 (`downloader.ts`) (Major)
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`
* **Affected Scope:** Lines 285–289 (`Target 4: src/services/modelManager/downloader.ts`)
* **Discrepancy Description**:
  Target 4 specifies:
  *"Update download destination directory resolution to use `await modelInstaller.getModelsDirectory()` instead of `path.join(os.homedir(), ...)`."*
  In reality, `src/services/modelManager/downloader.ts` does NOT perform destination directory resolution, nor does it contain `path.join(os.homedir(), ...)`. Its method signature accepts `modelsDir` passed directly from caller (`installer.ts`, lines 243–244).
* **Recommendation**:
  Remove the `os.homedir()` reference from Target 4. Clarify whether `downloader.ts` requires any modification at all, and relocate the directory resolution change exclusively to Target 3 (`installer.ts`), where `path.join(os.homedir(), '.voicenote', 'models')` actually resides.

### 4. Ambiguity in `installer.getModelsDirectory()` Synchronous vs. Asynchronous Contract (Major)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Lines 276–284 (`Target 3: installer.ts`), Line 288 (`Target 4: downloader.ts`)
* **Discrepancy Description**:
  Line 288 refers to `await modelInstaller.getModelsDirectory()`, suggesting that `getModelsDirectory()` is an async method returning `Promise<string>`.
  However, in `installer.ts` (line 155), `getModelsDirectory(): string` is currently a synchronous getter returning `this.modelsDir`.
* **Recommendation**:
  Explicitly specify the method signature and lifecycle of `modelInstaller.getModelsDirectory()`.

### 5. Incomplete Native Mocking Strategy for Jest / Node.js in `nativeAudio.ts` (Major)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** Line 274 (`Target 2: nativeAudio.ts`), Lines 301–308 (`Target 7: tests/modelInstaller.reconciliation.test.ts`)
* **Discrepancy Description**:
  Line 274 states: *"Provide in-memory/fs test mocks when `nativeAudio.isNativeAvailable` is false so Node.js/Jest tests pass without hardware."*
  In Jest, `NativeModules.VoiceNoteNativeAudio` is undefined. The plan must specify the exact fallback implementation using Node `fs` and `os.tmpdir()` for `getModelsDirectory()`, `readTextFile()`, `writeTextFile()`, `fileExists()`, and `listDirectory()`.
* **Recommendation**:
  Define the exact fallback implementation for `NativeAudioBridge` when `!this.isNativeAvailable`. In Tier 2 reconciliation, specify that it calls `verifyChecksum` from `@/services/modelManager/verifier` rather than invoking `nativeAudio.verifyFileChecksum` directly.

### 6. Concurrency Guard and Test Scope Gaps in Test Plan (Major)
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Line 280 (`Target 3`), Lines 301–308 (`Target 7: tests/modelInstaller.reconciliation.test.ts`)
* **Discrepancy Description**:
  Target 7 omits test cases for:
  - Single-flight concurrency: Multiple simultaneous calls to `modelInstaller.initialize()` returning the same promise without duplicate disk reads.
  - Empty models directory handling: App launching with an empty directory without manifest.
* **Recommendation**:
  Add explicit test cases for concurrent initialization and empty directory handling in Target 7.

### 7. HomeScreen UI Feedback Specification Gap (Nit)
* **Reviewer Lens:** `egm-style`, `egm-implementation-readiness`
* **Affected Scope:** Lines 290–295 (`Target 5: HomeScreen.tsx`)
* **Discrepancy Description**:
  Section 5 states the record button displays a subtle loading indicator, but Target 5 omits instructions on updating `AnimatedRecordButton`.
* **Recommendation**:
  Add an explicit instruction to pass `disabled={isInitializingModels}` or render an inline indicator.

### 8. Replace Passive Phrasing with Actionable Imperatives in Verification Plan (Nit)
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 318–321 (`Verification Plan`)
* **Recommendation**:
  Reformat verification instructions into active imperative commands (`Execute npm run typecheck...`, `Execute npm test...`).
