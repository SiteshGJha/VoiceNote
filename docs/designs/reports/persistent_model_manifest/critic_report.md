# Stage 7 Critic Review Report

* **Target Document:** `docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md` (`Lines 1..256`)
* **Reviewers:** `egm-design`, `egm-structural`, `egm-style`
* **Synthesis:** `egm-synthesizer`
* **Date:** 2026-11-17

---

## Reviewer Status

| Reviewer | Status | Lens Focus |
| :--- | :--- | :--- |
| `egm-design` | completed | Hostile design critique: architecture, failure modes, data integrity, race conditions, edge cases |
| `egm-structural` | completed | Document layout, heading hierarchy, template adherence, missing sections, diagram consistency |
| `egm-style` | completed | Passive voice removal, banned adjectives, precision, brevity, jargon elimination, fluff stripping |

---

## Severity Summary

* 🔴 **Blocker**: 2
* 🟡 **Major**: 7
* 🟢 **Nit**: 2

---

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. Missing Native Primitive for File Size Verification Breaks Tier 1 Fast Path (Blocker)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 27, 113–142, 149–157, 174–175, 190–194
* **Discrepancy Description:** 
  The Fast Path architecture explicitly asserts in Goal 3 (line 27) and the Tier 1 flowchart (lines 174–175) that startup registration validates both physical file presence and `sizeBytes` in `< 5 ms`. However, neither Section 2 (`AppDelegate.mm` native methods) nor Section 3 (`NativeAudioBridge` TypeScript contract) exposes a file size primitive (e.g., `getFileSize` or `statFile`). The only presence check exposed is `fileExists(filePath): Promise<boolean>`. Consequently, the step-by-step description of Tier 1 (line 192) only calls `nativeAudio.fileExists(model.localPath)`, dropping the size validation entirely. If an interrupted download or corrupted zero-byte file exists on disk, `fileExists` returns `true`, causing corrupt weights to be registered and crashing ML inference engines during first dictation.
* **Rationale & Recommendation:**
  Expose `RCT_EXPORT_METHOD(getFileSize:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)` in `AppDelegate.mm` and add `getFileSize(filePath: string): Promise<number>` to `NativeAudioBridge`. Update the Tier 1 algorithm to compare `getFileSize` against `spec.sizeBytes` before model registration.

### 2. Platform Architecture Isolation Breaks Cross-Platform Mobile Support (iOS & Android) (Blocker)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 113–158, Section 2 & Section 3
* **Discrepancy Description:**
  VoiceNote is explicitly defined as a cross-platform mobile and desktop application supporting iOS 16+, Android 10+, and macOS desktop (PRD lines 6–9 and project rule `00-project-context.md`). This design specification replaces the in-memory Node filesystem shim (`src/shims/fs.js`) inside `ModelInstallerService` with macOS-only native methods on `VoiceNoteNativeAudio` in `AppDelegate.mm`. It specifies no implementation, JSI binding, or fallback for iOS (`ios/VoiceNoteNativeAudio.mm`) or Android (`rust/voicenote-core/src/android_jni.rs` / Kotlin). Refactoring `installer.ts` to call these methods without platform-agnostic abstractions or mobile implementations will break model installation and reconciliation on iOS and Android.
* **Rationale & Recommendation:**
  Define the cross-platform abstraction contract in `NativeAudioBridge`. Either specify the parity implementations for iOS and Android, or document a platform adapter where macOS desktop utilizes native filesystem bridge methods while mobile platforms utilize platform sandboxes / encrypted MMKV storage.

### 3. Unhandled Synchronous Getter Race Condition During Asynchronous Initialization (Major)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 160–189, 205–212
* **Discrepancy Description:**
  `ModelInstallerService` previously initialized synchronously in its constructor. The new design introduces an asynchronous `initialize(): Promise<void>` guarded by a single-flight mutex. While `HomeScreen.tsx` is updated to await initialization when tapping the record button (line 211), existing components (`HomeScreen`, `FirstRunSetupModal`) synchronously query `modelInstaller.isProvisioned()` and `modelInstaller.getProvisioningStatus()` during initial mount before `useEffect` hooks complete. During deep reconciliation (which hashes 639 MB and takes 300–800 ms), `isProvisioned()` synchronously returns `false`, causing false-positive UI state flashes or premature modal displays.
* **Rationale & Recommendation:**
  Add a lifecycle state machine to `ModelInstallerService` (`'uninitialized' | 'initializing' | 'provisioned' | 'unprovisioned'`). Update `HomeScreen` and root components to render a non-blocking skeleton/loader while the status is `'initializing'`, ensuring no premature synchronous reads occur before `initialize()` resolves.

### 4. Underspecified and Incompatible Catalog Filename Matching Rules in Deep Reconciliation (Major)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 21, 28, 52, 57, 88–89, 181–182, 198–200
* **Discrepancy Description:**
  The specification repeatedly asserts that deep reconciliation scans `~/.voicenote/models/asr` and `slm` for `.gguf` files (lines 28, 88, 181). However, in `MODEL_CATALOG` (`catalog.ts`), Whisper model download URLs end in `.bin` (`ggml-base.bin`), whereas `getModelFileName(spec)` formats names as `${spec.id}-${spec.quant}.gguf`. The design does not define whether directory scanning filters strictly by `.gguf` extension, performs exact filename equality, parses regex patterns, or relies on SHA-256 matching. If scanning filters by `*.gguf` (as explicitly indicated in Mermaid line 88: `~/.voicenote/models/asr/*.gguf`), standard Whisper `.bin` weights will be ignored and reconciliation will fail.
* **Rationale & Recommendation:**
  Specify the exact directory scanning algorithm: list all files in `asr/` and `slm/`, evaluate candidates using `getModelFileName(spec)` and known aliases (`ggml-*.bin`), filter candidates by file size tolerance, and verify matching SHA-256 hashes against `MODEL_CATALOG`. Eliminate the hardcoded `*.gguf` glob pattern for ASR weights in diagrams and text.

### 5. Contract Contradiction: Omission of `verifyFileChecksum` and `moveFile` from Section 2 (Major)
* **Reviewer Lens:** `egm-structural` / `egm-design`
* **Affected Scope:** Lines 113–142 vs Lines 149–158
* **Discrepancy Description:**
  Section 2 states: "`VoiceNoteNativeAudio` in `AppDelegate.mm` will expose five asynchronous primitives" and lists only `getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, and `listDirectory`. However, Section 3 lists seven methods in `NativeAudioBridge` (including `verifyFileChecksum` and `moveFile`), and the architecture flowchart (lines 106, 183) directly invokes `verifyFileChecksum`. The document contradicts itself regarding the native interface surface.
* **Rationale & Recommendation:**
  Harmonize Section 2 with Section 3. State that `VoiceNoteNativeAudio` exposes seven primitives, or explicitly distinguish newly introduced filesystem primitives from pre-existing native methods (`verifyFileChecksum`, `moveFile`).

### 6. UI Blocking Risk: Missing GCD Queue Specification for Synchronous SHA-256 Hashing (Major)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 183, 200, 248
* **Discrepancy Description:**
  Non-Functional Requirements (line 248) mandate that file hashing execute strictly on a background queue (`DISPATCH_QUEUE_PRIORITY_DEFAULT`). However, in `macos/voicenote-macOS/AppDelegate.mm`, `VoiceNoteNativeAudio` declares `+ (BOOL)requiresMainQueueSetup { return YES; }` and does not configure a custom `methodQueue`. In the existing native implementation, `verifyFileChecksum` opens an `NSInputStream` and reads the file synchronously on the bridge invocation queue. Deep reconciliation of 639 MB will stall bridge traffic unless explicit background queue dispatching is implemented.
* **Rationale & Recommendation:**
  Explicitly mandate in Section 2 and Section 4 that `verifyFileChecksum` wraps its file stream hashing inside `dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ ... })` before resolving the React Native promise.

### 7. Missing Security, Path Traversal, and Sandbox Threat Analysis (Major)
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 117–142, 250–253
* **Discrepancy Description:**
  The design introduces unconstrained native file I/O primitives (`readTextFile`, `writeTextFile`, `listDirectory`) exposed to the JavaScript runtime without path sanitization or boundary enforcement. A compromised dependency or path traversal injection (e.g., `../../etc/passwd` or paths targeting user home directories outside `.voicenote`) could allow arbitrary file disclosure or file overwriting. The document lacks a Security & Threat Model section evaluating path confinement or macOS App Sandbox boundary compliance.
* **Rationale & Recommendation:**
  Add a dedicated **Security & Data Confinement** section. Mandate that native implementations in `AppDelegate.mm` resolve real canonical paths using `NSURL.standardizingPath` and assert that target paths are strictly prefixed by `~/.voicenote/models/`, throwing `FS_ACCESS_DENIED` on traversal attempts.

### 8. Pervasive Passive Voice and Unspecified Actors Across System Requirements (Major)
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 17–19, 34–36, 49, 53, 59, 251
* **Discrepancy Description:**
  Architectural specifications and system behaviors are repeatedly framed in the passive voice, obscuring component ownership.
* **Rationale & Recommendation:**
  Convert passive requirements into active voice specifying the concrete actor (e.g., "`ModelInstallerService` writes the manifest...", "`ModelDownloader` saves downloaded chunks to...", "`VoiceNoteNativeAudio.verifyFileChecksum` detects the checksum mismatch...").

### 9. Subjective Fluff, Banned Adjectives, and Unquantified Assertions (Major)
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 13, 27, 30, 146, 210, 227, 233
* **Discrepancy Description:**
  The text relies on subjective, imprecise adjectives and corporate fluff ("without blocking startup responsiveness", "subtle loading indicator", "actionable feedback", "sluggish perceived performance").
* **Rationale & Recommendation:**
  Replace unquantified fluff with concrete technical specifications (`< 10 ms`, renders `<ActivityIndicator size="small" />`, toast identifying corrupted model ID, avoids external native dependencies).

### 10. Inconsistent Cold-Start Performance Budget (Nit)
* **Reviewer Lens:** `egm-style` / `egm-structural`
* **Affected Scope:** Lines 27, 194, 246
* **Discrepancy Description:**
  Goal 3 states "Sub-5ms Startup on Valid Manifest (< 5 ms)", whereas Non-Functional Requirements defines the budget as "Cold-Start Launch Budget: Model registry loading on Tier 1 (manifest hit) must complete within `< 10 ms`".
* **Rationale & Recommendation:**
  Harmonize performance targets across the document.

### 11. Missing Structured Failure Modes & Fallback Matrix (Nit)
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 160–204
* **Discrepancy Description:**
  Error conditions are described narratively across scattered paragraphs rather than consolidated in a standard engineering fallback table.
* **Rationale & Recommendation:**
  Add a Markdown table mapping `Failure Scenario` | `Detection Trigger` | `Remediation / Fallback Action` | `UI / Error Surface`.
