# VoiceNote v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement VoiceNote v2 with chunked long-speech recording (zero data loss), hardware double-press trigger, offline reports engine (weekly/monthly/yearly dashboard), and enhanced UX (animated record button, search & filter FAB in history, onboarding wizard, in-app theme toggle).

**Architecture:** Layer 5 new subsystems cleanly on the existing bare React Native pipeline: extend `useSettingsStore` and `historyStorage` (500-item cap + date index) in storage; add `SegmentMerger`, `SegmentQueue`, and `ChunkedRecorder` to prevent data loss in long speech; provide `VoiceNoteHardwareTrigger` bridge with 400ms double-press detection; build pure `statsEngine` with SVG charts for reports; deliver focused UI components (`AnimatedRecordButton`, `HistorySearchBar`, `HistoryFilterFAB`, `OnboardingScreen`).

**Tech Stack:** React Native 0.76.9 (Bare workflow), TypeScript 5.6.3, Zustand 5, MMKV, React Native SVG (`react-native-svg`), Jest.

**Spec:** `docs/superpowers/specs/2026-09-30-voicenote-v2-design.md`

## Global Constraints

- 100% offline inference: zero cloud network calls (audit enforced via `npm run audit:privacy`).
- Zero telemetry and no tracking libraries.
- Audio temporary files deleted immediately post-ASR (even on error).
- Peak memory budget under 500 MB; max concurrent in-flight audio segments in JS memory ≤ 2.
- Backward compatibility: existing v1 history records must work without corruption or loss.
- Strict TypeScript: no `any`, `npm run typecheck` must pass with 0 errors.
- All existing 30 test suites (140 tests) must continue passing.

## Review Focus

1. **Overlap Word Duplication / Clipping**: Long recordings split at arbitrary boundaries must not produce duplicated words or dropped syllables when merged.
2. **Double-Press Race Conditions**: Rapid hardware button clicks (e.g. 3 or 4 rapid clicks) must trigger exactly one toggle action and not start/stop cycle out-of-sync.
3. **Empty or Sparse History in Reports**: Reports screen loaded on day 1 with 0 records or 1 record must render empty states gracefully without NaN or div-by-zero crashes.
4. **V1 History Migration**: Records without `wordCount`, `durationMs`, or `_v` must be safely loaded and rendered without crashing the history or reports screens.
5. **Onboarding State Transition**: First-time launch must gate to Onboarding; completing or skipping must immediately route to Home without requiring app restart.

---

### Task 1: Data Model, Storage Expansion & Date Indexing

**Files:**
- Modify: `src/ml/errors.ts`
- Modify: `src/services/history/types.ts`
- Modify: `src/services/history/storage.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/useSettingsStore.ts`
- Test: `tests/services/historyStorage.test.ts`

**Interfaces:**
- Consumes: `TranscriptionRecord` from `src/services/history/types.ts`, `DEFAULT_SETTINGS` from `src/state/types.ts`.
- Produces:
  - `TranscriptionRecord` with optional `_v?: number`, `wordCount?: number`, `durationMs?: number`, `segmentCount?: number`.
  - `MAX_HISTORY_RECORDS = 500`.
  - `historyStorage.getDateRange(startMs: number, endMs: number): Promise<TranscriptionRecord[]>`.
  - Settings: `hardwareTriggerButton: 'volume' | 'headphone' | 'none'`, `maxHistoryRecords: number`, `hasCompletedOnboarding: boolean`.
  - Errors: `'SEGMENT_MERGE_FAILED'`, `'RECORDING_LIMIT_REACHED'`, `'HARDWARE_TRIGGER_DENIED'`.

- [ ] **Step 1: Write failing tests for storage expansion, date range query, and v1 backfill**

Add tests to `tests/services/historyStorage.test.ts` verifying:
1. `MAX_HISTORY_RECORDS` is 500 and retains up to 500 records before FIFO eviction.
2. `addRecord` automatically calculates `wordCount` from `finalText` if not provided.
3. Legacy records without `wordCount` or `_v` are loaded with computed `wordCount` and `_v: 2`.
4. `getDateRange(startMs, endMs)` returns records matching timestamp range.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/services/historyStorage.test.ts`
Expected: FAIL due to missing `getDateRange` and cap set at 50.

- [ ] **Step 3: Update `src/ml/errors.ts`**

Add `'SEGMENT_MERGE_FAILED'`, `'RECORDING_LIMIT_REACHED'`, and `'HARDWARE_TRIGGER_DENIED'` to `MlErrorCode` and update `getUserFacingErrorMessage`.

- [ ] **Step 4: Update `src/services/history/types.ts` and `src/services/history/storage.ts`**

1. Update `TranscriptionRecord` with `_v?: number`, `wordCount?: number`, `durationMs?: number`, `segmentCount?: number`.
2. Change `MAX_HISTORY_RECORDS = 500`.
3. In `HistoryStorageService`, calculate `wordCount` on `addRecord`: `input.finalText.trim().split(/\s+/).filter(Boolean).length`.
4. In `initialize()`, map over loaded records to lazily populate `wordCount` and `_v: 2` on legacy records.
5. Implement `getDateRange(startMs: number, endMs: number): Promise<TranscriptionRecord[]>`.

- [ ] **Step 5: Update `src/state/types.ts` and `src/state/useSettingsStore.ts`**

Add `hardwareTriggerButton`, `maxHistoryRecords`, and `hasCompletedOnboarding` with default values and setters.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test tests/services/historyStorage.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ml/errors.ts src/services/history/types.ts src/services/history/storage.ts src/state/types.ts src/state/useSettingsStore.ts tests/services/historyStorage.test.ts
git commit -m "feat(storage): expand history to 500, add date range indexing and settings fields"
```

---

### Task 2: Segment Merger Algorithm

**Files:**
- Create: `src/audio/segmentMerger.ts`
- Test: `tests/audio/segmentMerger.test.ts`

**Interfaces:**
- Consumes: Array of raw string segments from sequential ASR calls.
- Produces: `mergeSegments(segments: string[]): string` (exported pure function).

- [ ] **Step 1: Write failing tests for segment merger**

Create `tests/audio/segmentMerger.test.ts` with test cases:
1. Empty array returns empty string.
2. Single segment returns exact text.
3. Two segments with exact overlap words (e.g. `["today we will discuss", "will discuss the project roadmap"]`) merges cleanly to `"today we will discuss the project roadmap"`.
4. Overlap with slight ASR variation (within 15% Levenshtein tolerance) correctly deduplicates without stuttering.
5. No overlap (e.g. paused speech across boundaries) joins with a single space.
6. Hindi Devanagari text overlap deduplication (e.g. `["आज हम बात करेंगे", "बात करेंगे नए प्रोजेक्ट पर"]`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/audio/segmentMerger.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `mergeSegments` in `src/audio/segmentMerger.ts`**

Implement tokenization, suffix-prefix sliding window comparison (up to 15 tokens window), Levenshtein distance check, and clean concatenation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/audio/segmentMerger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/segmentMerger.ts tests/audio/segmentMerger.test.ts
git commit -m "feat(audio): implement segmentMerger for overlap deduplication"
```

---

### Task 3: Chunked Audio Recording & Segment Queue

**Files:**
- Create: `src/audio/chunkedRecorder.ts`
- Create: `src/audio/segmentQueue.ts`
- Modify: `src/audio/types.ts`
- Test: `tests/audio/chunkedRecorder.test.ts`

**Interfaces:**
- Consumes: Audio frames (16kHz 16-bit PCM) from `useAudioRecorder` / `audioRecorder`.
- Produces:
  - `AudioSegment`: `{ index: number; pcm: Float32Array; startMs: number; durationMs: number; isLast: boolean }`.
  - `ChunkedRecorder`: `{ start(opts): Promise<void>; processFrame(frame: Float32Array): void; stop(): Promise<AudioSegment[]>; cancel(): void }`.
  - `SegmentQueue`: Sequential queue ensuring 1 in-flight ASR segment at a time.

- [ ] **Step 1: Write failing tests for ChunkedRecorder and SegmentQueue**

Create `tests/audio/chunkedRecorder.test.ts` testing:
1. Audio < 25s emits a single segment on stop.
2. Audio > 25s triggers chunk boundaries with 5s overlap (80,000 samples).
3. 25-minute duration warning and 30-minute limit cap callbacks.
4. SegmentQueue processes items sequentially and collects transcripts.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/audio/chunkedRecorder.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/audio/chunkedRecorder.ts` and `src/audio/segmentQueue.ts`**

1. Maintain rolling PCM buffer.
2. Segment duration: 30s; overlap: 5s.
3. Emit `AudioSegment` and manage memory disposal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/audio/chunkedRecorder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/types.ts src/audio/chunkedRecorder.ts src/audio/segmentQueue.ts tests/audio/chunkedRecorder.test.ts
git commit -m "feat(audio): add ChunkedRecorder and SegmentQueue for long audio"
```

---

### Task 4: Pipeline Orchestrator Integration for Long Speech

**Files:**
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/pipeline/types.ts`
- Test: `tests/pipeline/orchestrator.test.ts`

**Interfaces:**
- Consumes: `mergeSegments` from `src/audio/segmentMerger.ts`, `ChunkedRecorder` outputs.
- Produces: `executePipeline` supporting both single `RecordedAudio` and multi-segment processing with progress callbacks (`'asr'`, `'slm'`, `'saving'`, `'done'`).

- [ ] **Step 1: Write failing test for orchestrator chunked execution**

Update `tests/pipeline/orchestrator.test.ts` with a test case for multi-segment chunked pipeline execution, verifying:
1. Multiple ASR segments are executed and merged via `mergeSegments`.
2. Temporary audio files for each segment are strictly cleaned up immediately.
3. Result object includes total `audioDurationMs`, `wordCount`, and `segmentCount`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/pipeline/orchestrator.test.ts`
Expected: FAIL on chunked pipeline assertions.

- [ ] **Step 3: Update `src/pipeline/orchestrator.ts`**

Update `executePipeline` to accept segmented audio inputs, iterate through segments, merge transcripts with `mergeSegments`, pass merged text to SLM rewrite, save history with `wordCount` and `segmentCount`, and guarantee file cleanup.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/pipeline/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/types.ts src/pipeline/orchestrator.ts tests/pipeline/orchestrator.test.ts
git commit -m "feat(pipeline): wire chunked transcription and merge in orchestrator"
```

---

### Task 5: Hardware Trigger & Double-Press Detector

**Files:**
- Create: `src/services/doublePressDetector.ts`
- Create: `src/native/hardwareTrigger.ts`
- Test: `tests/services/doublePressDetector.test.ts`

**Interfaces:**
- Consumes: Timestamps / hardware events from device native listener.
- Produces:
  - `DoublePressDetector`: `{ press(timestamp?: number): boolean; reset(): void }`.
  - `useHardwareTrigger(onTrigger: () => void): void`.
  - `hardwareTrigger`: `{ setButton(btn: 'volume' | 'headphone' | 'none'): Promise<void> }`.

- [ ] **Step 1: Write failing tests for DoublePressDetector**

Create `tests/services/doublePressDetector.test.ts` testing:
1. Single press does not trigger.
2. Two presses within 400ms triggers `true`.
3. Two presses separated by > 400ms do not trigger.
4. Third press within 400ms of second press is debounced (does not re-trigger immediately).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/services/doublePressDetector.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/services/doublePressDetector.ts` and `src/native/hardwareTrigger.ts`**

1. `DoublePressDetector` with configurable 400ms window.
2. `hardwareTrigger` wrapper handling mock/native platform bridge with graceful fallbacks.
3. `useHardwareTrigger` React hook subscribing to native emitter when enabled in settings.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/services/doublePressDetector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/doublePressDetector.ts src/native/hardwareTrigger.ts tests/services/doublePressDetector.test.ts
git commit -m "feat(native): add double-press detector and hardware trigger module"
```

---

### Task 6: Offline Reports Engine (`statsEngine.ts`)

**Files:**
- Create: `src/services/statsEngine.ts`
- Test: `tests/services/statsEngine.test.ts`

**Interfaces:**
- Consumes: `TranscriptionRecord[]` from `historyStorage`.
- Produces: `computeStats(records: TranscriptionRecord[], period: 'week' | 'month' | 'year', referenceDate?: Date): PeriodStats`.

- [ ] **Step 1: Write failing tests for statsEngine**

Create `tests/services/statsEngine.test.ts` testing:
1. Empty records returns zeroes without NaN.
2. Week view aggregates Monday-to-Sunday daily word counts and calculates top hour.
3. Month view aggregates daily counts for reference month.
4. Year view aggregates monthly/daily counts.
5. Tone breakdown counts words for `professional` and `casual`.
6. Language breakdown counts words per language.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/services/statsEngine.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/services/statsEngine.ts`**

Pure function calculating `totalWords`, `totalNotes`, `totalDurationMs`, `avgWordsPerNote`, `byTone`, `byLang`, `dailyCounts`, `topHour`, and formatted period label.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/services/statsEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/statsEngine.ts tests/services/statsEngine.test.ts
git commit -m "feat(stats): implement statsEngine for weekly, monthly, yearly reports"
```

---

### Task 7: UI Reports Screen & SVG Visualizations

**Files:**
- Create: `src/utils/chartHelpers.ts`
- Create: `src/screens/ReportsScreen.tsx`
- Modify: `src/navigation/routes.ts`
- Modify: `src/navigation/AppNavigator.tsx`
- Test: `tests/screens/reportsScreen.test.ts`

**Interfaces:**
- Consumes: `computeStats` from `src/services/statsEngine.ts`, `historyStorage`.
- Produces: `ReportsScreen` registered in `AppNavigator` at route `'Reports'`.

- [ ] **Step 1: Write failing test for ReportsScreen**

Create `tests/screens/reportsScreen.test.ts` testing:
1. Renders period selector (`Week`, `Month`, `Year`).
2. Renders metric cards (Total Words, Total Notes, Average Words, Top Hour).
3. Switching period recalculates and updates view.
4. Back navigation button works.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/screens/reportsScreen.test.ts`
Expected: FAIL with screen not found.

- [ ] **Step 3: Implement `src/utils/chartHelpers.ts` and `src/screens/ReportsScreen.tsx`**

1. Build pure helper generating SVG paths / layout calculations for bar chart and tone breakdown donut.
2. Build `ReportsScreen` with period tabs, reference date pager (prev/next), summary cards, bar charts, and breakdown sections.
3. Register `Reports: undefined` in `src/navigation/routes.ts` and `AppNavigator.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/screens/reportsScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/chartHelpers.ts src/screens/ReportsScreen.tsx src/navigation/routes.ts src/navigation/AppNavigator.tsx tests/screens/reportsScreen.test.ts
git commit -m "feat(ui): add ReportsScreen with offline SVG charts and navigation"
```

---

### Task 8: History UX Enhancements (Search, Filter FAB & Navigation)

**Files:**
- Create: `src/components/HistorySearchBar.tsx`
- Create: `src/components/HistoryFilterFAB.tsx`
- Modify: `src/screens/HistoryScreen.tsx`
- Test: `tests/screens/historyScreen.test.ts`

**Interfaces:**
- Consumes: `TranscriptionRecord[]` from `historyStorage`.
- Produces: Debounced search, multi-criteria filter (Pro, Casual, En, Hi, Today, This Week), navigation to Reports screen.

- [ ] **Step 1: Write failing tests for History search and filter**

Update `tests/screens/historyScreen.test.ts` to test:
1. Typing in search bar filters notes by content (both `finalText` and `rawText`).
2. Selecting filter chip filters list by tone or language.
3. Clicking 📊 button navigates to `Reports`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/screens/historyScreen.test.ts`
Expected: FAIL on search/filter assertions.

- [ ] **Step 3: Implement `HistorySearchBar` and `HistoryFilterFAB`**

1. Create `HistorySearchBar` with 200ms debounce and clear button.
2. Create `HistoryFilterFAB` with expandable chip drawer.
3. Connect both in `HistoryScreen.tsx` and add Reports button in `Header`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/screens/historyScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/HistorySearchBar.tsx src/components/HistoryFilterFAB.tsx src/screens/HistoryScreen.tsx tests/screens/historyScreen.test.ts
git commit -m "feat(ui): add search bar, filter FAB, and reports navigation to HistoryScreen"
```

---

### Task 9: Animated Record Button & Waveform Performance Throttle

**Files:**
- Create: `src/components/AnimatedRecordButton.tsx`
- Modify: `src/components/Waveform.tsx`
- Modify: `src/screens/HomeScreen.tsx`
- Test: `tests/screens/homeScreen.test.ts`

**Interfaces:**
- Consumes: `useHardwareTrigger`, recording states from `useAppStore`.
- Produces:
  - 60fps native-driven animated record button with pulsing rings during recording and spinning indicator during processing.
  - 60ms throttled `Waveform` rendering to avoid UI thread thrashing on long recordings.

- [ ] **Step 1: Write failing test for AnimatedRecordButton**

Update `tests/screens/homeScreen.test.ts` to verify:
1. `AnimatedRecordButton` renders and triggers start/stop recording on tap.
2. Hardware trigger event triggers recording toggle.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/screens/homeScreen.test.ts`
Expected: FAIL on new assertions.

- [ ] **Step 3: Implement `AnimatedRecordButton.tsx` and update `Waveform.tsx` and `HomeScreen.tsx`**

1. Create `AnimatedRecordButton.tsx` with pulse animation loop when recording.
2. Throttle amplitude updates in `Waveform.tsx` to 60ms min interval.
3. Replace inline record button in `HomeScreen.tsx` and hook up `useHardwareTrigger`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/screens/homeScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/AnimatedRecordButton.tsx src/components/Waveform.tsx src/screens/HomeScreen.tsx tests/screens/homeScreen.test.ts
git commit -m "feat(ui): add AnimatedRecordButton, throttle waveform, and wire hardware trigger"
```

---

### Task 10: Onboarding Screen & Settings Updates (Theme & Trigger Pickers)

**Files:**
- Create: `src/screens/OnboardingScreen.tsx`
- Modify: `src/screens/SettingsScreen.tsx`
- Modify: `src/navigation/routes.ts`
- Modify: `src/navigation/AppNavigator.tsx`
- Test: `tests/screens/onboardingScreen.test.ts`

**Interfaces:**
- Consumes: `hasCompletedOnboarding`, `themeMode`, `hardwareTriggerButton` from `useSettingsStore`.
- Produces:
  - `OnboardingScreen` 4-slide horizontal wizard.
  - AppNavigator conditional initial route (`Onboarding` if not completed, else `Home`).
  - SettingsScreen controls for Hardware Trigger and Appearance (System / Light / Dark).

- [ ] **Step 1: Write failing test for Onboarding flow**

Create `tests/screens/onboardingScreen.test.ts` testing:
1. Renders slides (Welcome, Models, Defaults, Ready).
2. Completing onboarding sets `hasCompletedOnboarding: true` and navigates to `Home`.
3. Skipping onboarding marks completed and navigates to `Home`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/screens/onboardingScreen.test.ts`
Expected: FAIL with screen not found.

- [ ] **Step 3: Implement `OnboardingScreen.tsx` and update `SettingsScreen.tsx` & `AppNavigator.tsx`**

1. Implement `OnboardingScreen.tsx` with horizontal slide pager, model download status, and default settings picker.
2. Update `SettingsScreen.tsx` with Hardware Trigger selector and Appearance segmented buttons.
3. In `AppNavigator.tsx`, set initial route based on `hasCompletedOnboarding`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/screens/onboardingScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/OnboardingScreen.tsx src/screens/SettingsScreen.tsx src/navigation/routes.ts src/navigation/AppNavigator.tsx tests/screens/onboardingScreen.test.ts
git commit -m "feat(ui): add OnboardingScreen and update SettingsScreen with theme and trigger pickers"
```

---

### Task 11: End-to-End Verification & Compliance Audit

**Files:**
- Test: all test suites
- Script: `scripts/privacy-audit.js`

**Interfaces:**
- Consumes: All project code and tests.
- Produces: 100% passing test suites, 0 type errors, 0 privacy violations.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All 30+ test suites PASS.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run Privacy & Offline audit**

Run: `npm run audit:privacy`
Expected: 0 violations, clean pass.

- [ ] **Step 4: Final commit and verification log**

```bash
git status
git commit --allow-empty -m "chore: verify VoiceNote v2 test suites and privacy audit"
```
