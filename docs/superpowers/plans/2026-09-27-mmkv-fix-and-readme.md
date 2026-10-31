# MMKV Compatibility Fix & Comprehensive README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the `react-native-mmkv 3.x.x requires TurboModules` runtime failure on macOS/iOS/Android non-New-Architecture setups, provide resilient in-memory fallback, and author a comprehensive, production-grade `README.md` documenting the entire project architecture and technical guides.

**Architecture:** 
1. Downgrade `react-native-mmkv` to `^2.12.2` in `package.json` to support standard architecture (bridged & C++ JSI) across platforms without forcing TurboModules/New Architecture.
2. In `src/services/history/storage.ts`, wrap `new MMKV(...)` initialization in a defensive try/catch that falls back to an encrypted in-memory map on any native instantiation failure, ensuring the app never crashes even in environments where MMKV JSI fails to mount.
3. Author a complete, polished `README.md` at repo root drawing from `docs/PRD.md` and `docs/TECHNICAL_GUIDE.md`.

**Tech Stack:** React Native 0.76.9, react-native-macos 0.76.12, react-native-mmkv 2.12.2, TypeScript strict, Jest 29.

**Spec:** `docs/PRD.md` & `docs/TECHNICAL_GUIDE.md`

## Global Constraints

- Zero cloud inference: 100% on-device ASR and SLM rewriting.
- Zero telemetry, analytics, or tracking SDKs.
- Audio ephemerality: temporary recording files deleted immediately post-ASR.
- Offline encrypted history with OS Keychain-backed keys. Max 50 items (FIFO eviction).
- All 30 existing test suites (139 tests) must remain green.
- `npm run audit:privacy` must pass with zero violations.

## Review Focus

1. **MMKV 2.x API Compatibility:** `react-native-mmkv` 2.x constructor signature `new MMKV({ id, encryptionKey })` and methods (`getString`, `set`, `delete`, `clearAll`) must match `storage.ts` without type breakage.
2. **Defensive Fallback Execution:** If `new MMKV(...)` throws at runtime (e.g. TurboModules missing or JSI binding failed), the service must catch the error, log a warning, and fall back to in-memory records so note generation and history viewing continue to work smoothly.
3. **Keychain Key Handling:** Keychain key extraction must remain unchanged and secure.
4. **README Accuracy & Completeness:** Ensure every command, script name, folder structure, and pipeline stage in `README.md` strictly matches the actual repository codebase.

---

### Task 1: Downgrade `react-native-mmkv` to `^2.12.2` & Install Dependencies

**Files:**
- Modify: `package.json:26`
- Lockfile: `package-lock.json`

**Interfaces:**
- Consumes: npm package `react-native-mmkv@^2.12.2`
- Produces: Installed 2.x package avoiding TurboModule hard-requirement

- [ ] **Step 1: Update `package.json`**
  Change `"react-native-mmkv": "^3.1.0"` to `"react-native-mmkv": "^2.12.2"`.

- [ ] **Step 2: Run `npm install`**
  Run: `npm install`
  Expected: Package installs cleanly without dependency conflicts.

- [ ] **Step 3: Run existing tests and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: All 30 suites pass, 0 type errors.

- [ ] **Step 4: Commit**
  ```bash
  git add package.json package-lock.json
  git commit -m "fix(storage): downgrade react-native-mmkv to 2.12.2 for non-TurboModule compatibility"
  ```

---

### Task 2: Resilient Fallback in `HistoryStorageService`

**Files:**
- Modify: `src/services/history/storage.ts:13-30`
- Test: `tests/services/historyStorage.test.ts`

**Interfaces:**
- Consumes: `MMKV` from `react-native-mmkv`
- Produces: `historyStorage` service that never throws fatal exceptions on storage initialization

- [ ] **Step 1: Write unit test verifying graceful fallback on MMKV instantiation failure**
  In `tests/services/historyStorage.test.ts`:
  Add a test:
  ```ts
  it('falls back gracefully to in-memory storage if MMKV instantiation throws', async () => {
    const originalMMKV = (historyStorage as any).storage;
    // Force constructor or initialization to throw
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Verify addRecord and listRecords still succeed in fallback mode
    ...
  });
  ```

- [ ] **Step 2: Run test — verify failure / behavior**
  Run: `npx jest tests/services/historyStorage.test.ts -t 'falls back gracefully'`
  Expected: Test verifies behavior or fails if unhandled.

- [ ] **Step 3: Implement defensive fallback in `src/services/history/storage.ts`**
  Wrap `new MMKV(...)` in `try / catch`:
  ```ts
  try {
    this.storage = new MMKV({ id: 'voicenote-history', encryptionKey: key });
  } catch (mmkvError) {
    logger.warn('HistoryStorage', 'Native MMKV initialization failed, falling back to in-memory storage', mmkvError);
    this.storage = null;
  }
  ```
  If `this.storage` is null, proceed with in-memory array operations. Ensure `this.storage?.set(...)` safely handles `null`.

- [ ] **Step 4: Run test — verify pass**
  Run: `npx jest tests/services/historyStorage.test.ts --no-coverage`
  Expected: PASS

- [ ] **Step 5: Run full test suite & privacy audit**
  Run: `npm test && npm run audit:privacy && npm run typecheck`
  Expected: All 30 suites pass, 0 errors, audit passed.

- [ ] **Step 6: Commit**
  ```bash
  git add src/services/history/storage.ts tests/services/historyStorage.test.ts
  git commit -m "fix(storage): add graceful in-memory fallback on MMKV initialization error"
  ```

---

### Task 3: Author Comprehensive Project `README.md`

**Files:**
- Create: `README.md`

**Contents:**
- **Badges & Header:** Project title, pitch, badges for offline-only, zero-telemetry, TypeScript, React Native.
- **Key Features:**
  - On-Device ASR (Whisper: English, Hindi, Hinglish).
  - On-Device SLM Rewriting (Llama: Professional / Casual tones with entity preservation).
  - WebRTC Voice Activity Detection & Silence Auto-Stop.
  - Ephemeral Audio Processing (audio files deleted immediately after transcription).
  - Encrypted Offline Storage (MMKV + OS Keychain AES-256).
  - Adaptive Appearance (Runtime System Dark/Light Mode).
- **Architecture & Processing Pipeline:** ASCII / Mermaid diagram showing Audio → VAD → ASR → Cleanup → SLM → Storage.
- **Directory Structure:** Complete map of `src/` (`audio`, `components`, `ml`, `native`, `navigation`, `pipeline`, `screens`, `services`, `state`, `utils`).
- **Getting Started & Prerequisites:**
  - Node.js >= 18, macOS 13+, Xcode & CocoaPods for Apple targets, Android Studio for Android.
- **Running the Application:**
  - Desktop: `npm run macos`
  - iOS: `npm run ios`
  - Android: `npm run android`
- **Validation & Quality Commands:**
  - `npm test` (unit & integration tests)
  - `npm run typecheck` (TypeScript)
  - `npm run audit:privacy` (Strict privacy compliance checker)
- **Non-Negotiable Privacy & Engineering Principles:** Detailed documentation of PRD zero-cloud rules.

- [ ] **Step 1: Write `README.md`**
  Author the complete markdown document with all sections, code blocks, diagrams, and accurate file references.

- [ ] **Step 2: Verify markdown formatting and link integrity**
  Confirm all referenced commands and paths (`docs/PRD.md`, `docs/TECHNICAL_GUIDE.md`, etc.) are exact and valid.

- [ ] **Step 3: Run privacy audit and tests**
  Run: `npm run audit:privacy && npm test`
  Expected: Pass without issues.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md
  git commit -m "docs: add comprehensive project README with architecture, pipeline, and guides"
  ```

---

## Self-Review

1. **Spec coverage:** Addresses both the MMKV TurboModule failure and the structured README request.
2. **Step scan:** Each task is right-sized and has checkable test/build commands.
3. **Type consistency:** Preserves `react-native-mmkv` types and `historyStorage` contract.
4. **Review Focus:** Covered MMKV 2.x compatibility, graceful storage fallback, and complete README structure.
