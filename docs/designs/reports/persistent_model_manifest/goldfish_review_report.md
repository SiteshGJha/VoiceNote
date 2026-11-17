# Goldfish Annotated Review Report

**Target:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md` (`Lines 257..332`)
**Status:** resolved (All 8 PROPOSE FIX items applied)

## Prioritized Findings & AI Suggestions

### 1. Missing Native File Size API / Fast-Path Size Verification Gap [`egm-implementation-readiness`] - Severity: Blocker
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L260-L281` (Detailed Implementation Plan)
* **Discrepancy Description:** Line 281 mandates that Tier 1 Fast Path check file sizes on disk, but the native methods proposed in `AppDelegate.mm` and `NativeAudioBridge` only expose `fileExists -> boolean` with no `getFileSize` method.
* **Rationale:** A zero-byte or interrupted download file will return `fileExists === true`, causing corrupt weights to be registered and crashing ML inference engines.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Exposing `getFileSize` in `AppDelegate.mm` and `NativeAudioBridge` enables real-time verification of model file sizes against `spec.sizeBytes` during Tier 1 Fast Path.
* ***Proposed Edit:***
  * Location: `macos/voicenote-macOS/AppDelegate.mm` (Target 1), `src/native/nativeAudio.ts` (Target 2), and `src/services/modelManager/installer.ts` (Target 3)
  * Change: Add `RCT_EXPORT_METHOD(getFileSize:(NSString *)filePath resolver:... rejecter:...)` returning `NSNumber` file size via `NSFileManager`, add `getFileSize(filePath: string): Promise<number>` to `NativeAudioBridge`, and specify that Tier 1 compares `getFileSize` against `spec.sizeBytes`.

---

### 2. Undefined Return Semantics, Error Handling, and Parent Directory Creation in Native File Primitives [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L260-L268` (Target 1: `AppDelegate.mm`)
* **Discrepancy Description:** Native methods list shorthand signatures without defined error and return semantics for missing files (`readTextFile`), missing parent directories (`writeTextFile`), non-existent directories (`listDirectory`), or GCD queue dispatching.
* **Rationale:** Unhandled rejections on missing manifests will crash cold start; writes will fail if parent directory `~/.voicenote/models/` does not exist.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Specifying exact error contracts, recursive parent directory creation, and background queue dispatch ensures predictable behavior and prevents main-thread stalls.
* ***Proposed Edit:***
  * Location: `Target 1: macos/voicenote-macOS/AppDelegate.mm`
  * Change: Explicitly specify:
    1. `readTextFile`: Resolves `[NSNull null]` (not reject) if file does not exist; only rejects on read I/O error.
    2. `writeTextFile`: Recursively creates parent directory via `createDirectoryAtPath:withIntermediateDirectories:YES` before writing; writes atomically (`writeToFile:atomically:YES`); resolves `@(YES)`.
    3. `listDirectory`: Resolves empty array `@[]` if directory does not exist.
    4. GCD Dispatch: Dispatches disk reads and directory scans to `dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)`.

---

### 3. Factual Codebase Misalignment in Target 4 (`downloader.ts`) [`egm-codebase-details`] - Severity: Major
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L285-L289` (Target 4: `downloader.ts`)
* **Discrepancy Description:** Target 4 states it will update `downloader.ts` to replace `path.join(os.homedir(), ...)`, but `downloader.ts` does not contain `os.homedir()`. Its method accepts `modelsDir` passed directly from `installer.ts`.
* **Rationale:** Directs implementer to modify code that does not exist in `downloader.ts`.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Relocate the `modelsDir` resolution instruction exclusively to Target 3 (`installer.ts`), where `path.join(os.homedir(), ...)` actually lives. Update Target 4 to clarify that `downloader.ts` receives `modelsDir` from caller.
* ***Proposed Edit:***
  * Location: `Target 4: src/services/modelManager/downloader.ts`
  * Change: Remove reference to replacing `os.homedir()`. State that `downloader.ts` requires no directory resolution changes because it receives `modelsDir` directly from `installer.ts`.

---

### 4. Ambiguity in `installer.getModelsDirectory()` Synchronous vs. Asynchronous Contract [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L276-L284` (Target 3: `installer.ts`)
* **Discrepancy Description:** Document implies `modelInstaller.getModelsDirectory()` becomes asynchronous (`await modelInstaller.getModelsDirectory()`), but `getModelsDirectory(): string` is currently a synchronous getter.
* **Rationale:** Changing synchronous getters to async breaks existing synchronous call sites across the application.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Keep `getModelsDirectory(): string` synchronous by returning `this.modelsDir`, which is populated with a safe fallback and updated during `await modelInstaller.initialize()`.
* ***Proposed Edit:***
  * Location: `Target 3: src/services/modelManager/installer.ts`
  * Change: Specify that `getModelsDirectory(): string` remains a synchronous getter returning `this.modelsDir`, updated upon resolution of `initialize()`.

---

### 5. Incomplete Native Mocking Strategy for Jest / Node.js in `nativeAudio.ts` [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L274` (Target 2: `nativeAudio.ts`)
* **Discrepancy Description:** Line 274 states "Provide in-memory/fs test mocks", but does not specify how Jest executes without `NativeModules.VoiceNoteNativeAudio`.
* **Rationale:** If fallback methods are undefined, unit tests in `tests/` will fail in CI/Node.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Provide concrete mock fallbacks using Node `fs` and `os.tmpdir()` in `nativeAudio.ts` when `!this.isNativeAvailable`.
* ***Proposed Edit:***
  * Location: `Target 2: src/native/nativeAudio.ts`
  * Change: Specify mock implementations in `NativeAudioBridge`:
    - `getModelsDirectory()`: returns `path.join(os.tmpdir(), 'voicenote_test_models')`
    - `readTextFile(p)`: `fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null`
    - `writeTextFile(p, c)`: creates parent directory and writes `fs.writeFileSync(p, c, 'utf8')`
    - `fileExists(p)`: `fs.existsSync(p)`
    - `getFileSize(p)`: `fs.existsSync(p) ? fs.statSync(p).size : 0`
    - `listDirectory(p)`: `fs.existsSync(p) ? fs.readdirSync(p) : []`
    - Deep reconciliation delegates checksum hashing to `@/services/modelManager/verifier:verifyChecksum` (which includes Node.js crypto streaming).

---

### 6. Concurrency Guard and Test Scope Gaps in Test Plan [`egm-implementation-readiness`] - Severity: Major
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L301-L308` (Target 7: `tests/modelInstaller.reconciliation.test.ts`)
* **Discrepancy Description:** Test plan omits verification for concurrent simultaneous `initialize()` calls and empty directory launches.
* **Rationale:** Essential concurrency and edge-case guarantees are left untested.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Add test assertions verifying single-flight mutex locking and clean empty directory handling.
* ***Proposed Edit:***
  * Location: `Target 7: tests/modelInstaller.reconciliation.test.ts`
  * Change: Add test cases:
    1. Single-flight concurrent initialization: `Promise.all([modelInstaller.initialize(), modelInstaller.initialize()])` returns identical result without duplicate disk reads.
    2. Empty models directory handling: App launches with empty directory and correctly resolves `isProvisioned() === false` without throwing.

---

### 7. HomeScreen UI Feedback Specification Gap [`egm-style`, `egm-implementation-readiness`] - Severity: Nit
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L290-L295` (Target 5: `HomeScreen.tsx`)
* **Discrepancy Description:** Architecture mentions record button loading indicator, but Target 5 omits instructions on updating `AnimatedRecordButton`.
* **Rationale:** Visual feedback requirement is detached from component file tasks.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Add explicit instruction to pass `disabled={isInitializingModels}` and render `<ActivityIndicator size="small" />`.
* ***Proposed Edit:***
  * Location: `Target 5: src/screens/HomeScreen.tsx`
  * Change: Add sub-bullet instructing to disable record button and render inline activity indicator while `isInitializingModels` is true.

---

### 8. Replace Passive Phrasing with Actionable Imperatives in Verification Plan [`egm-style`] - Severity: Nit
* **Affected Scope:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md#L318-L321` (Verification Plan)
* **Discrepancy Description:** Uses passive constraint phrasing instead of active imperatives.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Improves actionable clarity for verification.
* ***Proposed Edit:***
  * Location: `Verification Plan` (Lines 318–321)
  * Change: Convert into active imperatives:
    - `Execute npm run typecheck (tsc --noEmit); verify 0 errors.`
    - `Execute npm run lint (eslint src/); verify 0 errors.`
    - `Execute npm run audit:privacy; confirm zero forbidden network calls or unapproved libraries.`
    - `Execute npm test; ensure all assertions in tests/modelInstaller.reconciliation.test.ts pass.`
