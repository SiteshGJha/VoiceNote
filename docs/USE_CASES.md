# VoiceNote — Technical Documentation: Use Cases

**Version:** 1.0.0
**Date:** 2026-09-18
**Source of truth:** `docs/PRD.md`, `docs/MODELS.md`, `docs/TASKS.md`, `App.tsx`, `src/` implementation
**Platforms:** iOS 16+ (bare React Native), Android 10+ (API 29+)
**Principle:** Fully offline, privacy-first. Zero cloud inference, zero telemetry, ephemeral audio.

---

## 1. System Overview

VoiceNote captures microphone audio (16 kHz mono PCM), gates it with Voice Activity Detection (VAD), transcribes it on-device with Whisper (English / Hindi / Hinglish), rewrites it on-device with a GGUF SLM (`llama.rn`) into Professional or Casual tone, and stores results encrypted.

### 1.1 Core Pipeline

```
Mic (16kHz PCM) → Audio Recorder → VAD Gate → Silence Trim
  → ASR (whisper.rn / sherpa-onnx) → [DELETE temp audio immediately]
  → SLM Rewrite (llama.rn) → Encrypted History (MMKV + Keychain)
  → Result UI (edit / copy / share)
```

Orchestrated by `src/pipeline/orchestrator.ts:14` (`executePipeline`), with stages `vad | asr | slm | saving | done` defined in `src/pipeline/types.ts:8`.

### 1.2 Tech Stack

| Layer | Implementation |
|---|---|
| App shell | React Native 0.76.9, React 18.3.1, TypeScript strict |
| Navigation | `@react-navigation/native-stack` v6, routes in `src/navigation/routes.ts:3` |
| State | Zustand: `src/state/useAppStore.ts:38` (pipeline), `src/state/useSettingsStore.ts:18` (settings) |
| Audio | `src/audio/recorder.ts`, `src/audio/useAudioRecorder.ts`, `src/native/audioWorker.ts`, `src/native/nativeAudio.ts` |
| VAD | WebRTC VAD via `src/native/webrtcVad.ts`, gate `src/audio/vadGate.ts`, presets `src/audio/vadPresets.ts`, trim `src/audio/silenceTrim.ts` |
| ASR | `src/ml/asr/index.ts`, `src/ml/asr/whisperRunner.ts`, `src/native/whisperNative.ts`, romanizer `src/ml/asr/romanize.ts` |
| SLM | `src/ml/slm/index.ts`, `src/ml/slm/llamaRunner.ts`, `src/native/llamaNative.ts`, prompts `src/ml/slm/promptBuilder.ts`, guard `src/ml/slm/validator.ts`, post `src/ml/slm/postProcess.ts` |
| Models | `src/services/modelManager/catalog.ts`, `downloader.ts`, `installer.ts`, `verifier.ts`, `storageQuota.ts`, UI `src/screens/ModelsScreen.tsx:19` |
| History | `src/services/history/storage.ts`, `keychain.ts`, `types.ts:3`, UI `src/screens/HistoryScreen.tsx:22` |
| Types | `src/ml/types.ts:3` (`Tone`, `Lang`, `DetectedLang`, `HindiOutputFormat`, `AsrModelTier`, `PipelineResult`) |
| Errors | `src/ml/errors.ts` (`MlErrorCode`: `AUDIO_RECORD_FAILED`, `ASR_TIMEOUT`, etc.) |
| Theming / UX | `src/utils/theme.ts`, `src/utils/haptics.ts`, `src/utils/logger.ts` |
| Entry | `App.tsx:9` (theme init, JSI smoke test via `src/native/smokeTest.ts`) |

### 1.3 Navigation Map

Defined in `src/navigation/routes.ts:3`:

```
Home → Result { result: PipelineResult }
Home → History → (modal Note Detail)
Home → Models
Home → Settings → Privacy
```

### 1.4 Actors

| Actor | Description |
|---|---|
| `User` | Owns device, records voice, manages notes/models/settings |
| `System` | VAD, ASR, SLM, storage quota, audio cleanup, encryption |
| `OS` | Microphone permission, Keychain, filesystem temp cache, Share sheet, Clipboard |

### 1.5 Global Constraints (apply to all UCs)

1. No audio/transcript leaves device. Inference off-main-thread / JSI isolates.
2. Temp audio deleted immediately after ASR — success or error (`src/pipeline/orchestrator.ts:35`, `95`).
3. Only network use: user-initiated HTTPS model download with SHA-256 verify.
4. History encrypted (MMKV + OS Keychain), capped at 50 records with FIFO eviction.
5. `AGENTS.md`: no mocks in release builds; `src/native/` simulations must be `__DEV__`-guarded.

---

## 2. Use-Case Catalog (Summary)

| ID | Use Case | Screen / Entry | Primary Actor |
|---|---|---|---|
| UC-01 | Start voice recording (with model guard) | `HomeScreen.tsx:87` | User |
| UC-02 | Live waveform + duration feedback | `HomeScreen.tsx:247`, `Waveform.tsx` | User |
| UC-03 | VAD auto-stop on silence | `HomeScreen.tsx:69`, `vadGate.ts` | System |
| UC-04 | No-speech short-circuit | `HomeScreen.tsx:128` | System |
| UC-05 | Cancel recording | `HomeScreen.tsx:285` | User |
| UC-06 | Select transcription language | `LanguageSelector.tsx`, `HomeScreen.tsx:238` | User |
| UC-07 | Select rewrite tone pre-recording | `ToneSelector.tsx`, `HomeScreen.tsx:233` | User |
| UC-08 | Offline transcription (EN/HI/Hinglish) | `pipeline/orchestrator.ts:30`, `ml/asr/` | System |
| UC-09 | Choose Hindi output format | `SettingsScreen.tsx:153`, `ml/asr/romanize.ts` | User |
| UC-10 | Tone rewriting (Professional/Casual) | `pipeline/orchestrator.ts:54`, `ml/slm/` | System |
| UC-11 | Instant tone re-rewrite on Result | `ResultScreen.tsx:64` | User |
| UC-12 | Toggle Raw vs Rewritten view | `ResultScreen.tsx:88` | User |
| UC-13 | Edit note inline | `ResultScreen.tsx:179` | User |
| UC-14 | Copy note to clipboard | `ResultScreen.tsx:100`, `HistoryScreen.tsx:36` | User |
| UC-15 | Share note via native sheet | `ResultScreen.tsx:117`, `HistoryScreen.tsx:92` | User + OS |
| UC-16 | Record new note / re-record | `ResultScreen.tsx:129` | User |
| UC-17 | View encrypted history list | `HistoryScreen.tsx:31` | User |
| UC-18 | View note detail modal | `HistoryScreen.tsx:174` | User |
| UC-19 | Delete single note | `HistoryScreen.tsx:56` | User |
| UC-20 | Clear all history | `HistoryScreen.tsx:72` | User |
| UC-21 | Download on-device model | `ModelsScreen.tsx:42` | User |
| UC-22 | Verify model integrity (SHA-256) | `ModelsScreen.tsx:68` | User |
| UC-23 | Delete model | `ModelsScreen.tsx:80` | User |
| UC-24 | View storage quota / usage | `ModelsScreen.tsx:190` | User |
| UC-25 | Configure app settings | `SettingsScreen.tsx:100` | User |
| UC-26 | View privacy & security guarantees | `PrivacyScreen.tsx:8` | User |
| UC-27 | Master wipe (history + settings) | `SettingsScreen.tsx:31` | User |
| UC-28 | Handle microphone permission | `HomeScreen.tsx:224`, `PermissionGate.tsx` | User + OS |
| UC-29 | Pipeline error handling & SLM fallback | `orchestrator.ts:38`, `60`, `93` | System |
| UC-30 | App startup, smoke test, theming | `App.tsx:13` | System |

---

## 3. Detailed Use Cases

### UC-01 — Start Voice Recording (with Model Guard)

- **Actors:** User
- **Preconditions:** App launched; microphone permission state known; settings loaded.
- **Trigger:** User taps 🎙 record button (`src/screens/HomeScreen.tsx:267`).
- **Main flow:**
  1. `handleStartRecording()` (`src/screens/HomeScreen.tsx:87`) calls `modelInstaller.listInstalled()`.
  2. Requires ≥1 `asr` + ≥1 `slm` installed. If missing → `Alert` "Models Required" with `Open Models` → navigates to `Models`.
  3. If satisfied: `vadGate.reset()`, `setStage('recording')` (`src/state/useAppStore.ts:47`), `useAudioRecorder.start()` begins 16 kHz capture on background worker.
  4. Per-frame callback feeds `VadGate.processFrame(chunk)`.
- **Alt flows:**
  - `A1` — `start()` throws → `setError('AUDIO_RECORD_FAILED', ...)` → error stage.
  - `A2` — Recording attempted while `transcribing/rewriting` → button `disabled={isProcessing}`.
- **Postconditions:** `stage=recording`; VAD listening; waveform animating.
- **NFR:** Capture off-main-thread; no network.

### UC-02 — Live Waveform + Duration Feedback

- **Actors:** User (observer)
- **Trigger:** While `recordingState==='recording'`.
- **Flow:** `useAudioRecorder` exposes `amplitude`, `durationMs` → `Waveform` (`src/components/Waveform.tsx`) + `${Math.floor(durationMs/1000)}s` label (`src/screens/HomeScreen.tsx:247`). Idle shows "Tap microphone to speak".
- **Postconditions:** None (read-only visualization).

### UC-03 — VAD Auto-Stop on Silence

- **Actors:** System
- **Preconditions:** Recording active; `vadSensitivity` in `{low, medium, high}` (`src/audio/vadPresets.ts`, default via `src/state/types.ts`).
- **Trigger:** Sustained silence after speech.
- **Flow:**
  1. `VadGate` constructed per sensitivity (`src/screens/HomeScreen.tsx:70`) with callbacks `onSpeechStart / onSpeechEnd / onAutoStop / onNoSpeech`.
  2. `onAutoStop` → `handleStopRecordingRef.current()` → `handleStopRecording()` finalizes audio, trims silence (`src/audio/silenceTrim.ts`), proceeds to UC-08.
- **Alt:** User manually taps ⏹ → same `handleStopRecording()` path (`src/screens/HomeScreen.tsx:115`).
- **Config:** UC-25 changes sensitivity live (gate re-created on change).

### UC-04 — No-Speech Short-Circuit

- **Actors:** System
- **Trigger:** `stop()` returns `audio.hasSpeech === false`.
- **Flow (`src/screens/HomeScreen.tsx:128`):** `setStage('idle')` + `Alert` "No Speech Detected" → no ASR call, no history write. Avoids wasted inference.
- **Postconditions:** No temp-file leak (recorder cleanup still runs); user stays on Home.

### UC-05 — Cancel Recording

- **Actors:** User
- **Trigger:** Tap `Cancel` under record button while recording (`src/screens/HomeScreen.tsx:285`).
- **Flow:** `cancel()` from `useAudioRecorder` discards buffer, `stage` returns to `idle`, no pipeline execution.
- **Postconditions:** No transcription, no history entry.

### UC-06 — Select Transcription Language

- **Actors:** User
- **Preconditions:** Not recording/processing (`disabled={isRecording || isProcessing}`).
- **Trigger:** `LanguageSelector` (`src/components/LanguageSelector.tsx`) on Home.
- **Options (`src/ml/types.ts:5`):** `auto` (detect), `en`, `hi`. Persisted default via `useSettingsStore.defaultLanguage`; per-note override via `useAppStore.activeLanguage` (`src/state/useAppStore.ts:49`). Synced on mount (`src/screens/HomeScreen.tsx:64`).
- **Downstream:** Passed as `lang` to `transcribe(uri, {lang, hindiOutput})` (`src/pipeline/orchestrator.ts:29`); Result subtitle shows `result.lang.toUpperCase()` (`src/screens/ResultScreen.tsx:138`).

### UC-07 — Select Rewrite Tone Pre-Recording

- **Actors:** User
- **Trigger:** `ToneSelector` (`src/components/ToneSelector.tsx`) on Home.
- **Options (`src/ml/types.ts:3`):** `professional` | `casual`. Default from settings, override per note via `activeTone`.
- **Downstream:** Passed as `tone` to `executePipeline` → `rewrite(raw, tone)`; stored in history record.

### UC-08 — Offline Transcription (EN / HI / Hinglish)

- **Actors:** System
- **Preconditions:** Valid `RecordedAudio` with speech; Whisper model installed per `asrModelTier` (`fast=tiny ~75MB`, `balanced=base ~145MB default`, `accurate=small ~480MB` — see `docs/MODELS.md:5`).
- **Trigger:** `handleStopRecording()` → `executePipeline(audio, {tone, lang, hindiOutput})`.
- **Flow:**
  1. Stage callback `asr` → UI `transcribing` + "Transcribing speech offline..." (`src/screens/HomeScreen.tsx:147`).
  2. `transcribe(audio.uri, ...)` (`src/ml/asr/index.ts`, `whisperRunner.ts`, `native/whisperNative.ts`) feeds 16 kHz buffer, detects `en|hi`, handles Hinglish bilingual prompt.
  3. On `ok`: capture `text`, `detectedLang`, `durationMs`. **Immediately** `audioRecorder.cleanupTempFile(uri)` (`src/pipeline/orchestrator.ts:35`).
  4. On `error`: cleanup still runs, return `{status:'error', code, message}` — see UC-29.
- **Postconditions:** `rawTranscript` in memory only; no audio file remains.
- **NFR:** 100% on-device CPU/NPU; off-main-thread; WER harness in `tests/asr/`, `scripts/`.

### UC-09 — Choose Hindi Output Format

- **Actors:** User
- **Options (`src/ml/types.ts:9`):** `devanagari` (हिंदी script) | `romanized` (Latin). Set in Settings (`src/screens/SettingsScreen.tsx:153`), stored as `hindiOutputFormat`.
- **Flow:** Passed through `executePipeline` → `transcribe(..., {hindiOutput})` → romanization post-processor (`src/ml/asr/romanize.ts`) transliterates when `romanized`.
- **Postconditions:** Affects stored `rawText`/`finalText` for Hindi notes.

### UC-10 — Tone Rewriting (Professional / Casual)

- **Actors:** System
- **Preconditions:** ASR succeeded; SLM model installed (`qwen2.5-0.5b ~350MB`, `palmer-005 ~380MB`, `gemma-2-2b ~1.4GB` — `docs/MODELS.md:11`); lazy-loaded via `llama.rn` (`src/ml/slm/llamaRunner.ts`, `src/native/llamaNative.ts`).
- **Trigger:** After ASR within `executePipeline`, unless `skipRewriting=true`.
- **Flow:**
  1. Stage `slm` → UI `rewriting` + "Rewriting tone on-device..." (`src/screens/HomeScreen.tsx:151`).
  2. `rewrite(raw, tone, {lang})` (`src/ml/slm/index.ts`) builds canonical prompt (`promptBuilder.ts`), runs inference, validates entity/fact preservation (`validator.ts: validatePreservation`), post-processes (`postProcess.ts`).
  3. `ok` → `finalRewrittenText = final`. `error`/hallucination-suspect → graceful fallback to `fallbackText` (= raw) + warn log (`src/pipeline/orchestrator.ts:60`).
- **Postconditions:** `PipelineResult {raw, final, tone, lang, totalDurationMs, audioDurationMs}` (`src/ml/types.ts:56`).

### UC-11 — Instant Tone Re-Rewrite on Result

- **Actors:** User
- **Preconditions:** On `Result` with `status==='ok'`.
- **Trigger:** Tap opposite tone pill (`src/screens/ResultScreen.tsx:64` `handleToneChange`).
- **Flow:** Guard same-tone/re-entrancy → `haptics.impactLight` → `rewrite(result.raw, newTone, {lang: result.lang})` → `runAfterInteractions` updates `displayText`; on failure shows `fallbackText`. `Rewriting...` indicator while busy. No re-recording, no re-ASR.
- **Postconditions:** `currentTone`, `displayText` updated; original `result.raw` preserved for further switches.

### UC-12 — Toggle Raw vs Rewritten View

- **Actors:** User
- **Trigger:** Tap `✨ Showing Rewritten / 📝 Showing Raw` chip (`src/screens/ResultScreen.tsx:88`).
- **Flow:** `isShowingRaw` flips; `displayText` swaps between `result.raw` and `result.final` (or last rewritten text). Haptic `impactLight`. Accessibility label reflects mode.
- **Purpose:** Transparency / verify SLM did not hallucinate.

### UC-13 — Edit Note Inline

- **Actors:** User
- **Trigger:** Type in note card `TextInput multiline` (`src/screens/ResultScreen.tsx:179`).
- **Flow:** Controlled `displayText` state; `onChangeText=setDisplayText`. Copy/Share operate on edited text. (History stores pipeline-time text; edits are export-time.)
- **Postconditions:** Exported text = edited text.

### UC-14 — Copy Note to Clipboard

- **Actors:** User
- **Trigger (Result):** `📋 Copy` (`src/screens/ResultScreen.tsx:100`); **(History detail):** `Copy` (`src/screens/HistoryScreen.tsx:36`).
- **Flow:** `haptics.success` → `Clipboard.setString(displayText|finalText)` (guarded `typeof setString==='function'`) → `✓ Copied!` toast 2s (`setCopiedToast`, `unref` timer for tests).
- **Postconditions:** System clipboard holds note text.

### UC-15 — Share Note via Native Sheet

- **Actors:** User + OS
- **Trigger:** `📤 Share` (`src/screens/ResultScreen.tsx:117`) or History detail `Share` (`src/screens/HistoryScreen.tsx:92`).
- **Flow:** `haptics.impactLight` → `Share.share({message: displayText, title:'VoiceNote Export'})`; errors logged, otherwise ignored.
- **Postconditions:** OS share sheet handles export; no app-side persistence.

### UC-16 — Record New Note / Re-Record

- **Actors:** User
- **Trigger:** `🎙 New` on Result (`src/screens/ResultScreen.tsx:129`) or Home record button.
- **Flow:** `haptics.impactLight` → `navigation.navigate('Home')`; `useAppStore` stage reset to `idle` on success path (`src/screens/HomeScreen.tsx:167`).
- **Postconditions:** Ready for UC-01.

### UC-17 — View Encrypted History List

- **Actors:** User
- **Preconditions:** Any prior successful pipeline run.
- **Trigger:** Tap 🕒 on Home → `History` (`src/screens/HomeScreen.tsx:194`), or deep navigation.
- **Flow (`src/screens/HistoryScreen.tsx:31`):** `historyStorage.listRecords()` (decrypted via MMKV+Keychain) → `FlatList` cards showing date, `💼 Pro|☕ Casual` tag, `EN|HI` tag, 2-line `finalText` snippet. Header subtitle `${records.length} / 50 encrypted notes`. Empty state explains cap + encryption.
- **Storage rule:** Max 50, FIFO eviction on `addRecord` (`src/services/history/storage.ts`; `src/pipeline/orchestrator.ts:73` writes after SLM).
- **Record shape (`src/services/history/types.ts:3`):** `{id, timestamp ISO8601, rawText, finalText, tone, lang, audioDurationMs, processingDurationMs}`.

### UC-18 — View Note Detail Modal

- **Actors:** User
- **Trigger:** Tap history card → `setSelectedRecord(item)`.
- **Flow:** Bottom-sheet `Modal` (`src/screens/HistoryScreen.tsx:174`) shows `Rewritten Text` (`finalText`) + `Raw Transcript` (`rawText` italic) + Copy/Share/Delete actions. `✕` dismisses.
- **Postconditions:** Read-only view; actions delegate to UC-14/15/19.

### UC-19 — Delete Single Note

- **Actors:** User
- **Trigger:** `Delete` in detail modal.
- **Flow (`src/screens/HistoryScreen.tsx:56`):** `Alert` confirm → `haptics.impactMedium` → `historyStorage.deleteRecord(id)` → close modal → `loadHistory()`.
- **Postconditions:** Record removed from encrypted store; count decrements.

### UC-20 — Clear All History

- **Actors:** User
- **Trigger:** 🗑 header action on History (`src/screens/HistoryScreen.tsx:143`).
- **Flow (`src/screens/HistoryScreen.tsx:72`):** Guard empty → `Alert` "Clear All History" (irreversible) → `haptics.warning` → `historyStorage.clearAll()` → reload (empty state).
- **Postconditions:** Zero records; encryption key retained.

### UC-21 — Download On-Device Model

- **Actors:** User
- **Preconditions:** Network available (only allowed network use); sufficient disk per quota.
- **Trigger:** `Download` on `Models` (`src/screens/ModelsScreen.tsx:42`).
- **Flow:**
  1. Guard concurrent download (`downloadingId`). `haptics.impactLight`, `setDownloadingId`.
  2. `modelInstaller.installModel(id, onProgress)` (`src/services/modelManager/installer.ts` → `downloader.ts` resumable HTTPS) updates `ProgressBar` (`src/components/ProgressBar.tsx`).
  3. Success → `haptics.success` + `Alert` "Model Installed... ready for offline use." Failure → `haptics.error` + `Alert` with message. Finally clear progress + `refreshModels()`.
- **Catalog (`src/services/modelManager/catalog.ts`, `docs/MODELS.md`):** ASR tiny/base/small; SLM qwen2.5-0.5b, palmer-005, gemma-2-2b. `recommended` badge = Default.
- **Postconditions:** Model marked `Installed (Offline)` with green dot.

### UC-22 — Verify Model Integrity (SHA-256)

- **Actors:** User
- **Trigger:** `Verify` on installed model (`src/screens/ModelsScreen.tsx:68`).
- **Flow:** `modelInstaller.verify(id)` (`src/services/modelManager/verifier.ts`) → `true` = "Integrity Verified... SHA-256 checksum verified." else "checksum mismatch or file missing." with matching haptics.
- **Postconditions:** No state change; informational only.

### UC-23 — Delete Model

- **Actors:** User
- **Trigger:** `Delete` on installed model (`src/screens/ModelsScreen.tsx:80`).
- **Flow:** `Alert` confirm (warns re-download needed) → `haptics.impactMedium` → `modelInstaller.deleteModel(id)` (`src/services/modelManager/installer.ts`) → `refreshModels()`.
- **Postconditions:** Frees `sizeBytes`; model returns to "Available for download". If no ASR/SLM remains, UC-01 will block with guard.

### UC-24 — View Storage Quota / Usage

- **Actors:** User (observer)
- **Trigger:** Open `Models` screen.
- **Flow (`src/screens/ModelsScreen.tsx:30`, `190`):** `getTotalStorageUsageBytes()` + `storageQuota.getStorageQuotaInfo(used)` (`src/services/modelManager/storageQuota.ts`) → banner `Local Storage Used: X MB / Y MB (Z%)`, `Free disk space: ...`, note "Models run 100% locally... zero network calls during inference."
- **Enforcement:** Quota/eviction checks during `installModel`; user must delete models to free space.

### UC-25 — Configure App Settings

- **Actors:** User
- **Entry:** ⚙️ on Home → `Settings` (`src/screens/SettingsScreen.tsx:26`).
- **Options (each an option-row group, `renderOptionRow`):**
  1. `Default Rewriting Tone`: professional | casual → `setDefaultTone`
  2. `Default Language`: auto | en | hi → `setDefaultLanguage`
  3. `VAD Sensitivity`: low (Noisy) | medium | high (Quiet) → `setVadSensitivity` (live-retunes UC-03)
  4. `ASR Model Tier`: fast (Tiny) | balanced (Base) | accurate (Small) → `setAsrModelTier`
  5. `Hindi Output Format`: devanagari | romanized → `setHindiOutputFormat` (see UC-09)
  6. `Appearance`: system | light | dark → `setThemeMode` (drives `lightTheme/darkTheme`, `StatusBar` in `App.tsx:19`)
  7. `Haptic Feedback` Switch → `setHapticsEnabled` (gates all `haptics.trigger` calls)
- **Persistence:** `useSettingsStore` (Zustand + encrypted MMKV per TASKS Phase 1). `resetAllSettings()` used by UC-27.
- **Postconditions:** Home defaults sync via `useEffect` (`src/screens/HomeScreen.tsx:64`).

### UC-26 — View Privacy & Security Guarantees

- **Actors:** User
- **Trigger:** `🛡️ Privacy & Zero-Cloud Guarantees` row in Settings → `Privacy` (`src/screens/SettingsScreen.tsx:188`).
- **Content (`src/screens/PrivacyScreen.tsx:13`):** Hero "🛡️ 100% Offline — Your Voice Never Leaves Your Phone" + 5 cards: Zero Cloud Inference, Zero Audio Persistence, Zero Telemetry, Encrypted History (50/FIFO/Keychain), Explicit Network Scope (HTTPS model weights + SHA-256 only).
- **Postconditions:** Informational; no actions.

### UC-27 — Master Wipe (History + Settings)

- **Actors:** User
- **Trigger:** `🗑 Delete All Data (Master Reset)` in Settings (`src/screens/SettingsScreen.tsx:31`).
- **Flow:** `Alert` "Master Data Wipe" (irreversible) → `haptics.warning` → `historyStorage.clearAll()` + `resetAllSettings()` → "Data Wiped" confirmation.
- **Postconditions:** Zero notes; settings back to `DEFAULT_SETTINGS` (`src/state/types.ts`); models untouched (use UC-23 to free weights).

### UC-28 — Handle Microphone Permission

- **Actors:** User + OS
- **Trigger:** Home renders `PermissionGate` (`src/components/PermissionGate.tsx`, `src/screens/HomeScreen.tsx:224`).
- **Flow:** If `permissionGranted=false`, gate explains + `onRequestPermission` → OS prompt. Current default `useState(true)` assumes granted; denial surfaces as `AUDIO_RECORD_FAILED` via UC-01-A1. Cancel/record blocked until granted.
- **Postconditions:** Recording allowed only with OS grant.

### UC-29 — Pipeline Error Handling & SLM Fallback

- **Actors:** System
- **Contexts:**
  1. **ASR failure** (`src/pipeline/orchestrator.ts:38`): return `{status:'error', code, message}` after guaranteed audio cleanup; Home shows `Alert` "Transcription Notice" + `setError(code,message)` → `stage=error` (`src/screens/HomeScreen.tsx:170`); Result error branch offers "Return to Home" (`src/screens/ResultScreen.tsx:38`).
  2. **SLM failure/hallucination** (`src/pipeline/orchestrator.ts:60`): `fallbackText` (= raw) used, warn logged, pipeline still succeeds and saves — user sees raw with rewrite skipped. Same on Result re-rewrite (`src/screens/ResultScreen.tsx:77`).
  3. **Unexpected exception** (`src/pipeline/orchestrator.ts:93`): cleanup + `{code:'ASR_TIMEOUT', message}` with partial `raw` if available.
  4. **No-speech** → UC-04 (not an error).
- **Metrics:** `setMetrics({totalDurationMs})`, `InteractionManager.runAfterInteractions` for UI transition (off-main-thread responsiveness).

### UC-30 — App Startup, Smoke Test, Theming

- **Actors:** System
- **Trigger:** App launch (`App.tsx:9`).
- **Flow:** `SafeAreaProvider` + `StatusBar` style from `themeMode`; `logger.info('VoiceNote initialized in offline mode')`; `__smokeTest()` JSI bridge check (`src/native/smokeTest.ts`) logged. `AppNavigator` mounts Home.
- **Postconditions:** Offline-ready shell; failures visible in logs, non-blocking.

---

## 4. Non-Functional Requirements & Acceptance Criteria

| Category | Requirement | Verification |
|---|---|---|
| Offline | ASR+SLM zero network after model install; only model download uses network | `npm run audit:privacy` (`scripts/privacy-audit.js`), manual airplane-mode test |
| Privacy | Temp audio deleted even on error; no analytics SDKs | Code review `orchestrator.ts:35,95`; `package.json` dep scan; PrivacyScreen guarantees |
| Perf | ML off-main-thread; UI transitions via `runAfterInteractions`; SLM tok/s targets in `MODELS.md:11` | `tests/scripts/benchmarks.test.ts`, `perf-profiling` skill, `InteractionManager` usage |
| Storage | History ≤50 FIFO; models quota-checked; sizes in `catalog.ts` | `tests/history/storage.test.ts`, `tests/modelManager/storageQuota.test.ts` |
| Reliability | SLM hallucination guard `validatePreservation`; WER harness for ASR | `tests/slm/validator.test.ts`, `tests/asr/transcribe.test.ts`, fixtures |
| i18n | EN/HI auto-detect, Hinglish prompt, romanization option | `tests/asr/romanize.test.ts`, `tests/slm/rewrite.test.ts` |
| Accessibility | All touchables have `accessibilityRole/label`; theme contrast | `tests/screens/uiFlow.test.ts`, manual VoiceOver/TalkBack |
| Quality gates | `npm test`, `npm run typecheck`, `npm run lint` green | CI / `jest.config.js` |

---

## 5. Traceability: Screens → Use Cases → Code

| Screen | UCs | Key Files |
|---|---|---|
| Home | UC-01–07, UC-08/10 (via pipeline), UC-25(partial), UC-28 | `screens/HomeScreen.tsx`, `audio/*`, `components/ToneSelector.tsx`, `LanguageSelector.tsx`, `Waveform.tsx`, `PermissionGate.tsx` |
| Result | UC-11–16, UC-29 | `screens/ResultScreen.tsx`, `ml/slm/index.ts` |
| History | UC-17–20, UC-14/15 | `screens/HistoryScreen.tsx`, `services/history/*` |
| Models | UC-21–24 | `screens/ModelsScreen.tsx`, `services/modelManager/*`, `components/ProgressBar.tsx` |
| Settings | UC-25, UC-27 (+link UC-26) | `screens/SettingsScreen.tsx`, `state/useSettingsStore.ts` |
| Privacy | UC-26 | `screens/PrivacyScreen.tsx` |
| Pipeline (headless) | UC-08, UC-10, UC-29 | `pipeline/orchestrator.ts`, `ml/asr/*`, `ml/slm/*` |

---

## 6. Open Gaps / Future Use Cases (not yet implemented)

- Search/filter history, pin/favorite notes, folders/tags.
- Export history backup (encrypted) / import.
- Streaming/partial ASR results during recording.
- Speaker diarization, punctuation restoration toggle.
- Per-note model-tier override; auto model-update checks.
- Widgets, shortcuts, Siri/Assistant intents (offline).

All must preserve §1.5 constraints if added.
