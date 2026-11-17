# Task Plan: Persistent On-Disk Model Management & macOS Cold-Start Reconciliation

> **Status:** Completed
> **Date:** 2026-11-17
> **Spec:** [`docs/designs/persistent_model_manifest_and_cold_start_reconciliation.md`](../designs/persistent_model_manifest_and_cold_start_reconciliation.md)

**Goal:** Permanently resolve the macOS desktop cold-start model download prompt by persisting `installed_models.json` to `~/.voicenote/models/` via native Objective-C++ file primitives, aligning path resolution with the user's home directory, and implementing two-tier cold-start reconciliation for existing model weights.

**Architecture:** 
1. Expose 6 native physical file I/O primitives (`getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, `getFileSize`, `listDirectory`) on `VoiceNoteNativeAudio` in `AppDelegate.mm`, dispatching to background queues with atomic file writing.
2. Wrap native methods in `src/native/nativeAudio.ts` with strict TypeScript types and safe Node.js/Jest mock fallbacks.
3. In `src/services/modelManager/installer.ts`, implement single-flight async `initialize(): Promise<void>` supporting Tier 1 Fast Path (< 10 ms check of `fileExists` and `getFileSize`) and Tier 2 Deep Reconciliation (directory scanning of `asr/` and `slm/`, matching against `MODEL_CATALOG`, and background SHA-256 validation via `verifyChecksum`).
4. Update `HomeScreen.tsx` and `App.tsx` with startup initialization synchronization and record button gating to eliminate race conditions and modal flashing.

**Tech Stack:** React Native 0.76 (macOS desktop), Objective-C++ (`AppDelegate.mm`), TypeScript, Jest (`tests/modelInstaller.reconciliation.test.ts`).

---

## 1. Acceptance Criteria & Edge Cases

- **Cold-Start Persistence**: After downloading models or seeding the manifest, quitting the app process (`Command+Q`) and restarting restores installed models without displaying `FirstRunSetupModal`.
- **Sub-10ms Startup (Fast Path)**: If `~/.voicenote/models/installed_models.json` exists on disk and physical files match expected byte sizes, model registration completes in `< 10 ms` without main-thread blocking.
- **Deep Reconciliation (Manifest Recovery)**: If `installed_models.json` is deleted or corrupted but valid `.gguf` / `.bin` weights exist on disk, the app automatically scans `asr/` and `slm/`, verifies SHA-256 checksums, recreates the manifest, and unlocks dictation without network requests.
- **Corrupt File Remediation**: If an existing file on disk fails checksum or has an invalid size, it is excluded from the manifest and flagged for targeted single-model re-download.
- **Single-Flight Concurrency**: Multiple concurrent calls to `modelInstaller.initialize()` (e.g. from `App.tsx` and `HomeScreen.tsx`) return the identical promise without duplicate disk reads.
- **Empty Directory Handling**: Launching with an empty models directory cleanly resolves `isProvisioned() === false` without throwing unhandled promise rejections.
- **Non-Existent Directory Fallbacks**: Native `listDirectory` resolves `@[]` if directories do not exist yet; `readTextFile` resolves `[NSNull null]` on missing files; `writeTextFile` creates parent directories recursively before atomic writing.
- **Zero Cloud Inference & Telemetry**: 100% offline compliance verified via `npm run audit:privacy`.
- **Strict Compilation & Tests**: `npm run typecheck`, `npm run lint`, and `npm test` pass with 0 errors.

---

## 2. Required API Contracts & Interface Definitions

### A. Native Audio Bridge Objective-C++ Methods (`AppDelegate.mm`)
```objc
RCT_EXPORT_METHOD(getModelsDirectory:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
RCT_EXPORT_METHOD(readTextFile:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
RCT_EXPORT_METHOD(writeTextFile:(NSString *)filePath content:(NSString *)content resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
RCT_EXPORT_METHOD(fileExists:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
RCT_EXPORT_METHOD(getFileSize:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
RCT_EXPORT_METHOD(listDirectory:(NSString *)dirPath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject);
```

### B. NativeAudioBridge TypeScript Contract (`src/native/nativeAudio.ts`)
```typescript
export interface NativeAudioBridge {
  getModelsDirectory(): Promise<string>;
  readTextFile(filePath: string): Promise<string | null>;
  writeTextFile(filePath: string, content: string): Promise<boolean>;
  fileExists(filePath: string): Promise<boolean>;
  getFileSize(filePath: string): Promise<number>;
  listDirectory(dirPath: string): Promise<string[]>;
  verifyFileChecksum(filePath: string, expectedSha256: string): Promise<boolean>;
  moveFile(sourcePath: string, targetPath: string): Promise<boolean>;
}
```

### C. ModelInstallerService Lifecycle (`src/services/modelManager/installer.ts`)
```typescript
export class ModelInstallerService {
  public getModelsDirectory(): string;
  public initialize(): Promise<void>;
  public isProvisioned(): boolean;
  public getProvisioningStatus(): ProvisioningStatus;
}
```

---

## 3. Step-by-Step Implementation Tasks

### Task 1: Create Automated Unit Test Suite (TDD RED)
**Files:**
- Create: `tests/modelInstaller.reconciliation.test.ts`

- [x] **Step 1.1**: Write test suite covering:
  - Fast Path verification: Pre-seeded manifest and files restore models immediately.
  - Deep Reconciliation: Unmanifested `.gguf` model files with valid checksums are scanned, manifested, and registered.
  - Corrupt File Recovery: Files failing checksum or size matching are excluded and flagged.
  - Cold-Start Persistence: Verify manifest survival across simulated service reinvocations.
  - Single-flight concurrency: `Promise.all([initialize(), initialize()])` executes once without duplicate disk operations.
  - Empty directory handling: App launching with an empty directory cleanly resolves `isProvisioned() === false` without throwing.
- [x] **Step 1.2**: Run `npm test tests/modelInstaller.reconciliation.test.ts` to confirm tests fail on current implementation (RED phase).

---

### Task 2: Implement Native Objective-C++ Physical File Primitives
**Files:**
- Modify: `macos/voicenote-macOS/AppDelegate.mm`

- [x] **Step 2.1**: Implement `getModelsDirectory` returning `~/.voicenote/models` via `NSHomeDirectory()` with recursive directory creation.
- [x] **Step 2.2**: Implement `readTextFile` reading UTF-8 text via `[NSString stringWithContentsOfFile:encoding:error:]` on a background queue, resolving `[NSNull null]` if file does not exist.
- [x] **Step 2.3**: Implement `writeTextFile` ensuring parent directory exists with `createDirectoryAtPath:withIntermediateDirectories:YES`, then writing string atomically via `writeToFile:atomically:YES`.
- [x] **Step 2.4**: Implement `fileExists` returning boolean from `[[NSFileManager defaultManager] fileExistsAtPath:filePath]`.
- [x] **Step 2.5**: Implement `getFileSize` returning `NSNumber` file size via `attributesOfItemAtPath:error:` or `-1` if file missing.
- [x] **Step 2.6**: Implement `listDirectory` returning `NSArray<NSString *>` from `contentsOfDirectoryAtPath:error:`, resolving `@[]` if directory does not exist.
- [x] **Step 2.7**: Ensure all disk operations dispatch to `dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0)`.

---

### Task 3: Expose Bridge Methods with Jest Fallbacks
**Files:**
- Modify: `src/native/nativeAudio.ts`

- [x] **Step 3.1**: Add `getModelsDirectory`, `readTextFile`, `writeTextFile`, `fileExists`, `getFileSize`, and `listDirectory` to `NativeAudioBridge` class.
- [x] **Step 3.2**: Wire each method to invoke `NativeModules.VoiceNoteNativeAudio` when available.
- [x] **Step 3.3**: Provide concrete Node.js `fs` / `os.tmpdir()` mock fallbacks when `!this.isNativeAvailable` so Jest and CI environments execute smoothly.

---

### Task 4: Upgrade `ModelInstallerService` with Two-Tier Reconciliation
**Files:**
- Modify: `src/services/modelManager/installer.ts`

- [x] **Step 4.1**: Keep `getModelsDirectory(): string` as a synchronous getter returning `this.modelsDir`, initialized to a safe default path and updated upon resolution of `initialize()`.
- [x] **Step 4.2**: Replace direct calls to `src/shims/fs.js` with `nativeAudio` physical I/O methods.
- [x] **Step 4.3**: Implement single-flight async `initialize(): Promise<void>` guarded by `initializationPromise`.
- [x] **Step 4.4**: Implement Tier 1 Fast Path: read `installed_models.json`, check `fileExists` and `getFileSize === model.sizeBytes`, and populate `installedModels` Map.
- [x] **Step 4.5**: Implement Tier 2 Deep Reconciliation: scan `asr/` and `slm/` subdirectories, match against `getModelFileName(spec)` and aliases, verify checksum via `verifyChecksum`, auto-construct `installed_models.json`, and register engines.
- [x] **Step 4.6**: Update `persistManifest()` to write atomically via `nativeAudio.writeTextFile()`.
- [x] **Step 4.7**: Run `npm test tests/modelInstaller.reconciliation.test.ts` to confirm tests pass (GREEN phase).

---

### Task 5: UI Startup Synchronization & Gating
**Files:**
- Modify: `src/screens/HomeScreen.tsx`
- Modify: `App.tsx`

- [x] **Step 5.1**: In `App.tsx`, trigger `modelInstaller.initialize()` concurrently with native smoke tests on startup.
- [x] **Step 5.2**: In `HomeScreen.tsx`, add `isInitializingModels` state awaiting `modelInstaller.initialize()` in `useEffect`.
- [x] **Step 5.3**: In `HomeScreen.tsx`, pass `disabled={isInitializingModels}` to `AnimatedRecordButton` and render `<ActivityIndicator size="small" />` while initializing.
- [x] **Step 5.4**: In `HomeScreen.tsx`, guard `handleStartRecording` to await initialization before checking `modelInstaller.isProvisioned()`.

---

### Task 6: Documentation & Phase Tracking
**Files:**
- Modify: `docs/TASKS.md`

- [x] **Step 6.1**: Add Phase 10 task checklist items for macOS Persistent On-Disk Model Management & Cold-Start Reconciliation.

---

### Task 7: Full Verification Loop
**Scope:** Strict regression testing and code quality verification.

- [x] **Step 7.1**: Run `npm run typecheck` (`tsc --noEmit`) to verify 0 TypeScript errors.
- [x] **Step 7.2**: Run `npm run lint` (`eslint src/`) to verify 0 linting errors.
- [x] **Step 7.3**: Run `npm test` across all test suites to confirm 100% passing tests and zero regressions.
- [x] **Step 7.4**: Run `npm run audit:privacy` to verify zero network leakage or unauthorized dependencies.
