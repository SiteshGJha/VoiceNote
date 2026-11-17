# Stage 6 Comprehension Review Report

**Target Document:** [`docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md)  
**Evaluator Persona:** `egm-comprehension` (Naive Reader / Zero Institutional Knowledge)  
**Standard:** Self-containment, clarity of flow, and comprehensibility  
**Date:** 2026-11-17

---

## 1. Paraphrase of Target Scope

### Paraphrase of Feature Specification (Lines 1–256)
* **How the existing system works, per this document**:  
  VoiceNote runs locally on macOS and relies on offline ML model weights (~639 MB) for speech dictation and tone rewriting. Currently, the application writes its model installation manifest (`installed_models.json`) to an in-memory Node filesystem shim (`src/shims/fs.js`) inside the React Native bundle, while attempting to resolve paths with `os.homedir()`, which polyfills to root (`"/"`). Consequently, quitting the macOS app wipes the in-memory records, leaving the app convinced no models are installed (`isProvisioned()` returns false), forcing the user to re-download the entire 639 MB model bundle on every launch. Furthermore, existing valid `.gguf` weight files on disk are ignored at startup due to the lack of any disk discovery or reconciliation logic.
* **What this proposes (Problem, Value Proposition & User Journeys)**:  
  This design replaces the in-memory shim with direct physical macOS filesystem operations rooted at `~/.voicenote/models/`. It introduces a two-tier startup lifecycle:
  1. *Tier 1 (Fast Path)*: Reads an on-disk JSON manifest and verifies referenced model files on disk in under 5–10 ms without blocking the main UI.
  2. *Tier 2 (Deep Reconciliation)*: If the manifest is missing or damaged, scans the `asr/` and `slm/` subdirectories, computes SHA-256 checksums in the background against a predefined `MODEL_CATALOG`, auto-generates the manifest, and registers the models without network access.
  In terms of user experience (CUJs), first-time downloads persist permanently across app restarts; deleted manifests are automatically regenerated from existing files without prompting for re-downloads; and if a specific model weight is corrupted, only that damaged file is flagged for targeted re-download while keeping healthy models intact.

### Paraphrase of Detailed Implementation (Lines 257–332)
* **Concrete Technical Changes & Components**:  
  The plan modifies 6 existing files and adds 2 new/updated files across native and TypeScript layers:
  1. [`macos/voicenote-macOS/AppDelegate.mm`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/macos/voicenote-macOS/AppDelegate.mm): Exposes 5 native Objective-C++ methods via `VoiceNoteNativeAudio` (`getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, `listDirectory`).
  2. [`src/native/nativeAudio.ts`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/src/native/nativeAudio.ts): Adds typed methods to `NativeAudioBridge` calling the native module, with in-memory fallbacks for unit tests.
  3. [`src/services/modelManager/installer.ts`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/src/services/modelManager/installer.ts): Replaces `fs` shims with `nativeAudio`, introduces an async `initialize()` mutex, implements Tier 1 manifest loading and Tier 2 deep reconciliation, and updates manifest saves to use atomic file writing.
  4. [`src/services/modelManager/downloader.ts`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/src/services/modelManager/downloader.ts): Updates destination path resolution to use the native model directory.
  5. [`src/screens/HomeScreen.tsx`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/src/screens/HomeScreen.tsx) & [`App.tsx`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/App.tsx): Initiates model initialization on app mount and adds an `isInitializingModels` loading guard to the record button to avoid false-positive setup modals.
  6. [`docs/TASKS.md`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/docs/TASKS.md): Tracks Phase 10 implementation checklist.
* **Verification Steps**:  
  Verification relies on static checks (`npm run typecheck`, `npm run lint`), a privacy audit (`npm run audit:privacy` to confirm zero network telemetry), a new automated Jest suite ([`tests/modelInstaller.reconciliation.test.ts`](file:///Users/siteshjha/Desktop/projects/github/VoiceNote/tests/modelInstaller.reconciliation.test.ts)) covering fast-path loading, deep reconciliation, corrupt file handling, and cold restart persistence, followed by a manual macOS run (download weights, inspect physical file, Command+Q quit, relaunch directly to recording).

---

## 2. Comprehension Audit Findings

### 🔴 Blocker

#### 1. Discrepancy Between File Size Verification Claims and Native Bridge API
* **Affected Scope:** Lines 27, 174–175, 192, 239, 281
* **Discrepancy Description & Rationale:**
  The document repeatedly asserts that the Tier 1 Fast Path checks file sizes on disk:
  - Line 27: *"If the physical manifest exists and referenced files match expected byte sizes..."*
  - Line 174–175 (Flowchart): `Fast Path: Verify sizeBytes of entries` $\rightarrow$ `All files present with matching size?`
  - Line 239: *"...verifying physical presence and size instantly..."*
  - Line 281: *"Implement Tier 1 Fast Path: read installed_models.json, check file sizes, and register models in < 5 ms."*
  
  However, in the proposed native primitives in Section 2 (lines 117–142), Section 3 (lines 149–157), and Target File 1 (lines 266–267), the only existence method exposed is:
  `fileExists(filePath: string): Promise<boolean>`
  
  Furthermore, line 192 (Section 4 Tier 1 Step 2) states:
  *"2. Parse JSON. For each model entry, call `nativeAudio.fileExists(model.localPath)`."* (No size checking).
  
  Because React Native on desktop cannot use Node's `fs.statSync` to inspect file sizes without a native binding, a developer following this spec has no way to verify `sizeBytes`.
  * **Remediation:** Either:
    1. Add `getFileSize(filePath: string): Promise<number>` or `statFile(...)` to `VoiceNoteNativeAudio` and `NativeAudioBridge`; OR
    2. Explicitly clarify that Tier 1 relies solely on existence (`fileExists`) and manifest-stored `sizeBytes`, updating the text, flowchart, and detailed plan to eliminate the contradictory claims of real-time file size verification.

---

### 🟡 Major

#### 2. Undefined Catalog Matching Criteria in Deep Reconciliation
* **Affected Scope:** Lines 182, 199, 282
* **Discrepancy Description & Rationale:**
  The document states: *"Scan ~/.voicenote/models/asr and slm"* and *"Match found filenames against MODEL_CATALOG entries."*  
  For an engineer without institutional context, it is undefined how a physical filename on disk (e.g. `whisper-base-multilingual-Q5_1.gguf`, `qwen2.5-0.5b-instruct-q4_k_m.gguf`, or `ggml-base.bin`) maps to a catalog entry. Does it compare against `getModelFileName(spec)` from `catalog.ts`? Does it match by substring of `spec.id`? Does it match the download URL's basename?  
  * **Remediation:** Explicitly state the matching algorithm inline (e.g., `"Match scanned filenames against getModelFileName(spec) defined in catalog.ts, or match by spec.id prefix"`).

#### 3. Misleading Reference to "Background Worker" in React Native Architecture
* **Affected Scope:** Lines 183, 248
* **Discrepancy Description & Rationale:**
  Flowchart node 183 specifies: `HashFiles[Run verifyFileChecksum in background worker]`.  
  In React Native bare architecture, there are no Web Workers or JavaScript worker threads. Background operations are performed natively on GCD / dispatch queues. Referring to a "background worker" implies creating a Web Worker or Worker thread in JavaScript.  
  * **Remediation:** Change node 183 to `HashFiles[Run verifyFileChecksum via native background queue]` to match Line 248 and avoid confusion about JS workers. Additionally, confirm in Target File 1 whether `verifyFileChecksum` needs explicit dispatch to `DISPATCH_QUEUE_PRIORITY_DEFAULT`.

#### 4. Omission of `InstalledModel` and `installed_models.json` Schema Definition
* **Affected Scope:** Lines 17, 25, 49, 184–185, 201–202
* **Discrepancy Description & Rationale:**
  The manifest file is the central artifact of this design, yet nowhere does the document specify its schema. The reader does not know if `installed_models.json` is a JSON array (`InstalledModel[]`) or a key-value dictionary (`Record<string, InstalledModel>`), nor what properties an `InstalledModel` object contains (`id`, `kind`, `displayName`, `sizeBytes`, `version`, `localPath`, `installedAt`).
  * **Remediation:** Provide the TypeScript interface for `InstalledModel` and an example JSON payload inline in Section 4.

#### 5. Unhandled Non-Existent Directory Behavior in `listDirectory`
* **Affected Scope:** Lines 139–141, 181, 198, 267
* **Discrepancy Description & Rationale:**
  While `getModelsDirectory` creates `~/.voicenote/models`, the `asr/` and `slm/` subdirectories may not exist on a fresh install. On macOS, `[[NSFileManager defaultManager] contentsOfDirectoryAtPath:dirPath error:&error]` returns `nil` and populates `error` if the path does not exist. If `listDirectory` rejects its promise when a directory is absent, deep reconciliation will throw unhandled rejections during cold start.
  * **Remediation:** Specify whether `listDirectory` resolves with an empty array `[]` when the directory does not exist, or whether `installer.ts` ensures `asr/` and `slm/` subdirectories are created before invoking `listDirectory`.

---

### 🔵 Nit

#### 6. Undefined Domain Acronyms and Formats (`ASR`, `SLM`, `GGUF`)
* **Affected Scope:** Lines 11, 21, 35
* **Discrepancy Description & Rationale:**
  The terms `ASR` (Automatic Speech Recognition), `SLM` (Small Language Model), and `GGUF` (GPT-Generated Unified Format) are used without definition or external links. A fresh reader joining the project may not know these domain acronyms.
  * **Remediation:** Spell out each acronym on its first appearance (e.g. *"Whisper Automatic Speech Recognition (ASR)"*, *"Small Language Model (SLM)"*, and *".gguf (GGUF model binary format)"*).

#### 7. Ambiguity Between Pre-Existing and New Bridge Methods
* **Affected Scope:** Lines 115–142, 149–158, 272–274
* **Discrepancy Description & Rationale:**
  Section 2 states that `VoiceNoteNativeAudio` will expose "five asynchronous primitives", but Section 3 presents an interface with 7 methods (including `verifyFileChecksum` and `moveFile`). The reader is left wondering why `verifyFileChecksum` and `moveFile` are in the TypeScript interface but missing from the Objective-C++ description in Section 2.
  * **Remediation:** Add a brief note in Section 2 indicating that `verifyFileChecksum` and `moveFile` are already implemented in `AppDelegate.mm`.

#### 8. Latency SLA Discrepancy (5 ms vs. 10 ms)
* **Affected Scope:** Line 27 vs. Line 246
* **Discrepancy Description & Rationale:**
  Goal 3 (Line 27) states "Sub-5ms Startup on Valid Manifest", whereas Line 246 states "Model registry loading on Tier 1 (manifest hit) must complete within `< 10 ms`". 
  * **Remediation:** Align both to either `< 5 ms` or `< 10 ms`.

#### 9. Unlisted Helper `modelInstaller.getModelsDirectory()` in Target File 3
* **Affected Scope:** Lines 288–289 vs. 276–284
* **Discrepancy Description & Rationale:**
  Target File 4 (`downloader.ts`) states it will call `await modelInstaller.getModelsDirectory()`. However, Target File 3 (`installer.ts`) does not list exposing `getModelsDirectory(): Promise<string>` on `ModelInstallerService`.
  * **Remediation:** Add `getModelsDirectory(): Promise<string>` to the list of changes for `installer.ts`.

#### 10. Missing Context on External Singletons (`asrModelRegistry`, `slmModelRegistry`)
* **Affected Scope:** Lines 77, 186, 193, 203
* **Discrepancy Description & Rationale:**
  The registries are referenced as destinations for model registration, but their source paths (`@/ml/asr/modelRegistry`, `@/ml/slm/modelRegistry`) and method signatures (`registerInstalledModel(id, path)`) are not defined.
  * **Remediation:** Add a 1-sentence note linking their import paths and registration method signatures.

---

### Conclusion & Verdict
The document presents a well-structured architectural solution to the macOS cold-start model persistence problem. Once the **Blocker** (resolving file-size check vs. `fileExists`) and the **Major** gaps (catalog matching rules, JS worker wording, manifest schema, and missing-directory handling) are addressed, the document will be fully self-contained and ready for implementation.
