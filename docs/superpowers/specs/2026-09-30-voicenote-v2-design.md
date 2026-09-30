# VoiceNote v2 — Design Specification

**Date:** 2026-09-30  
**Status:** Approved by human partner  
**Scope:** Five new production subsystems added to the existing VoiceNote architecture  

---

## 1. Product Intent & Success Criteria

### Intent
Extend the existing offline-first VoiceNote app (Phases 1–6 complete) with:

1. **Chunked Long-Speech Pipeline** — zero data loss for recordings up to 30 minutes
2. **Hardware Double-Press Trigger** — configurable volume/headphone button shortcut
3. **Reports Engine & Screen** — in-app weekly/monthly/yearly stats dashboard
4. **UX Improvements** — animated record button, history search + FAB filter, onboarding wizard, in-app theme toggle
5. **Performance Hardening** — memory budgets, throttled waveform, history index

### Success Criteria
- A 5-minute recording produces a single coherent merged transcript with no dropped words at overlap boundaries.
- Double-pressing the configured hardware button starts/stops recording from the foreground app within 400ms.
- The Reports screen renders all three period views (week/month/year) in < 100ms on a mid-range device (Snapdragon 665 / A14 equivalent).
- All 21 existing Jest test suites continue passing 100% after all changes.
- `npm run audit:privacy` produces zero violations.
- `npm run typecheck` produces zero errors.
- Peak memory during a 30-minute recording session stays under 500 MB.

### Non-Negotiable Constraints (inherited)
- Zero cloud inference. Zero telemetry. Audio deleted immediately after ASR.
- All ML inference off JS main thread.
- Models not bundled in binary.

---

## 2. Architecture Overview

```
VoiceNote v2 — System Map

┌────────────────────────────────────────────────────────────────┐
│                      EXISTING (unchanged)                       │
│   Audio → VAD → ASR (Whisper) → SLM (llama.rn) → History      │
│                        Pipeline Orchestrator                    │
└────────────────────────────┬───────────────────────────────────┘
                             │  extended at orchestrator.ts
         ┌───────────────────┼────────────────────┐
         ▼                   ▼                    ▼
  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
  │  Chunked     │   │ Hardware       │   │  Reports         │
  │  Recorder    │   │ Trigger Module │   │  Engine + Screen │
  │  + Merger    │   │ (iOS+Android)  │   │  (SVG charts)    │
  └──────────────┘   └────────────────┘   └──────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │                         UX Layer (new)                        │
  │  AnimatedRecordButton · HistorySearch · FAB Filter            │
  │  OnboardingScreen · ThemeToggle                               │
  └──────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Changes

### 3.1 TranscriptionRecord (extended, backward-compatible)

```typescript
// src/services/history/types.ts
interface TranscriptionRecord {
  // ── Existing fields (unchanged) ──────────────────────────────
  id: string;            // UUID v4
  timestamp: number;     // Unix ms
  rawText: string;       // Raw Whisper output
  finalText: string;     // SLM-rewritten text
  tone: Tone;            // 'professional' | 'casual'
  lang: Lang;            // 'en' | 'hi' | 'auto'
  // ── NEW fields (optional for migration compatibility) ─────────
  _v?: number;           // Schema version: 2. Absent on old records = v1.
  wordCount?: number;    // Pre-computed on save: finalText.split(/\s+/).filter(Boolean).length
  durationMs?: number;   // Recording duration in milliseconds
  segmentCount?: number; // Number of audio chunks merged (1 for short recordings)
}
```

**Migration:** On first read of a v1 record (missing `_v`), `historyStorage` back-fills `wordCount` from `finalText` and writes `_v: 2`. No full migration pass — lazy, per-record, on access.

**Capacity:** Increase FIFO cap from 50 → **500** records. Update constant in `src/services/history/storage.ts`.

### 3.2 SettingsStore (extended)

```typescript
// src/state/useSettingsStore.ts — new fields added
interface SettingsStore {
  // ── Existing fields (unchanged) ──────────────────────────────
  defaultTone: Tone;
  defaultLanguage: Lang;
  vadSensitivity: VadSensitivity;
  hindiOutputFormat: HindiOutputFormat;
  // ── NEW fields ────────────────────────────────────────────────
  hardwareTriggerButton: 'volume' | 'headphone' | 'none'; // default: 'volume'
  themeMode: 'system' | 'light' | 'dark';                 // default: 'system'
  maxHistoryRecords: number;                               // default: 500
  hasCompletedOnboarding: boolean;                         // default: false
}
```

### 3.3 History Secondary Index

`historyStorage` maintains a secondary sorted index:

```typescript
// Stored at MMKV key 'history_date_index'
type DateIndex = Array<[timestamp: number, id: string]>; // sorted ascending
```

Updated on every `saveRecord` / `deleteRecord` / `clearAll` call. Used by `statsEngine` for O(log n) date range slicing without scanning all records.

---

## 4. Chunked Long-Speech Pipeline

### 4.1 Overview

Recordings ≤ 25s: existing single-pass path (unchanged).  
Recordings > 25s: `ChunkedRecorder` splits PCM into overlapping 30s segments, each transcribed sequentially by Whisper, results merged by `SegmentMerger`.

### 4.2 Segment Window Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Segment duration | 30s | Whisper's trained context window |
| Overlap | 5s (80,000 samples @ 16 kHz) | Enough for merger to align sentence boundaries |
| Max concurrent segments in memory | 2 | 2 × ~1.9 MB PCM = ~3.8 MB; stays well within 500 MB budget |
| Max recording duration | 30 minutes | Hard cap; user warned at 25 min, stopped at 30 min |

### 4.3 New Files

#### `src/audio/chunkedRecorder.ts`
```typescript
interface AudioSegment {
  index: number;        // 0-based segment number
  pcm: Float32Array;    // 16 kHz mono PCM
  startMs: number;      // Offset from recording start
  durationMs: number;
  isLast: boolean;      // True on stop/auto-stop
}

interface ChunkedRecorderOptions {
  onSegment: (seg: AudioSegment) => void;
  onDurationWarning: (remainingMs: number) => void; // fired at 25min
  onLimitReached: () => void;                        // fired at 30min
}

class ChunkedRecorder {
  start(opts: ChunkedRecorderOptions): Promise<void>;
  stop(): Promise<void>;     // emits final segment with isLast=true
  cancel(): void;
}
```

**Implementation notes:**
- Internally maintains a rolling `Float32Array` ring buffer of 30s + 5s overlap
- At each 25s mark (non-overlap content filled), emits current segment and starts a new window beginning 5s before the emit point
- PCM buffer for emitted segments is released after `onSegment` callback returns (GC eligible)

#### `src/audio/segmentQueue.ts`
```typescript
// FIFO queue; feeds segments one-at-a-time to Whisper (sequential, not parallel)
class SegmentQueue {
  enqueue(seg: AudioSegment): void;
  // Returns merged partial transcript so far (for live UI preview)
  getPartialTranscript(): string;
  // Flushes remaining queue and returns final merged transcript
  flush(): Promise<string>;
  clear(): void;
}
```

#### `src/audio/segmentMerger.ts`
```typescript
// Deduplicates overlap region between two adjacent transcripts
// Strategy: find the longest suffix of transcript[n] that is a prefix of transcript[n+1]
// Levenshtein distance threshold: ≤ 15% of overlap token count
function mergeSegments(segments: string[]): string;
```

**Merge algorithm:**
1. Tokenize each transcript on whitespace.
2. For adjacent pair (A, B): take last K tokens of A and first K tokens of B (K = estimated overlap word count from 5s at average speaking rate ~150 wpm ≈ 12 tokens).
3. Find longest common suffix/prefix using Levenshtein with 15% error tolerance.
4. Discard duplicated tokens from B's head; concatenate.
5. If no alignment found (silence gap): join with `" "` (no dedup needed).

#### `src/pipeline/orchestrator.ts` (extended)
- `executePipeline` detects if input is `AudioBuffer` (single) or `SegmentedAudio` (chunked)
- For chunked: iterates `SegmentQueue`, calls Whisper per segment, feeds results to `SegmentMerger`, then runs SLM on merged transcript
- Pipeline stage callbacks extended: `'segment_N_of_M'` stage for UI progress display

### 4.4 Error Handling

| Scenario | Behaviour |
|---|---|
| Whisper times out on one segment | Segment marked `[transcription failed]`; merge continues with remaining |
| Recording limit reached (30 min) | Auto-stop; existing segments transcribed and merged; result saved with warning banner in UI |
| App backgrounded mid-recording (iOS) | `AVAudioSession` interruption handler stops recording; existing segments flushed and saved |
| Merger fails to align | Segments joined with newline; `SEGMENT_MERGE_FAILED` logged; UI shows transcript with visible segment boundaries |

---

## 5. Hardware Double-Press Trigger

### 5.1 Architecture

```
JS layer                        Native layer
────────────────────────────    ──────────────────────────────────
hardwareTrigger.ts              iOS: VoiceNoteHardwareTriggerModule.swift
  setButton(btn)         ──►      AVAudioSession outputVolume observer
  onDoublePressDetected  ◄──      MPRemoteCommandCenter togglePlayPause
                                  
doublePressDetector.ts          Android: VoiceNoteHardwareTriggerModule.kt
  400ms double-press              KEYCODE_VOLUME_UP (MainActivity.onKeyDown)
  window + debounce               KEYCODE_HEADSETHOOK (BroadcastReceiver)
```

### 5.2 Native Module Interface

**JS bridge — `src/native/hardwareTrigger.ts`:**
```typescript
type TriggerButton = 'volume' | 'headphone' | 'none';

interface HardwareTriggerModule {
  // Registers/unregisters native listeners for the given button
  setButton(button: TriggerButton): Promise<void>;
  // Native event name: 'VoiceNoteHardwareTrigger'
  // Emitted with payload: { button: TriggerButton, timestamp: number }
}

// Hook for component use
function useHardwareTrigger(onTrigger: () => void): void;
```

### 5.3 Platform Behaviour

| Button | iOS | Android |
|---|---|---|
| `volume` | `AVAudioSession` output volume KVO; volume reset after detection to avoid side effect | `KEYCODE_VOLUME_UP` in `MainActivity.onKeyDown`; `super.onKeyDown` NOT called (prevents volume change) |
| `headphone` | `MPRemoteCommandCenter.togglePlayPauseCommand` | `KEYCODE_HEADSETHOOK` via `BroadcastReceiver` on `Intent.ACTION_MEDIA_BUTTON` |
| `power` | ❌ Not interceptable without private API — shown as disabled in Settings | ❌ Not reliably interceptable — shown as disabled in Settings |
| `none` | Deregisters all listeners | Deregisters all listeners |

### 5.4 `doublePressDetector.ts`
```typescript
// Pure JS; no native dependency
class DoublePressDetector {
  private lastPressTime: number = 0;
  private readonly windowMs: number; // default: 400

  constructor(windowMs?: number);
  // Returns true if this press completes a double-press
  press(timestamp?: number): boolean;
  reset(): void;
}
```

### 5.5 Settings UI

`SettingsScreen` gains a **Hardware Trigger** section:
```
Hardware Trigger Button
  ○ Volume button          (works on both platforms)
  ○ Headphone/earpiece     (works on both platforms)
  ○ Power button           (Not supported — greyed out)
  ○ Disabled
```

`HomeScreen` registers/unregisters the trigger on mount/unmount via `useHardwareTrigger` hook. Double-press starts recording if idle, stops recording if active.

---

## 6. Reports Engine & Screen

### 6.1 `src/services/statsEngine.ts`

**Public API:**
```typescript
interface DailyCount {
  date: string;   // 'YYYY-MM-DD'
  words: number;
}

interface PeriodStats {
  period: 'week' | 'month' | 'year';
  label: string;                              // 'This Week', 'September 2026', '2026'
  totalWords: number;
  totalNotes: number;
  totalDurationMs: number;
  avgWordsPerNote: number;
  byTone: { professional: number; casual: number }; // word counts
  byLang: Partial<Record<Lang, number>>;             // word counts
  dailyCounts: DailyCount[];                         // 7 / 28-31 / 365 entries
  topHour: number | null;                            // 0-23; null if no data
  topHourNoteCount: number;
}

function computeStats(
  records: TranscriptionRecord[],
  period: 'week' | 'month' | 'year',
  referenceDate?: Date   // defaults to Date.now()
): PeriodStats;
```

**Implementation notes:**
- Pure function — no side effects, fully testable in Jest/Node
- Date slicing uses the secondary `DateIndex` for range lookup before iterating records
- Missing `wordCount` on v1 records is computed inline (not persisted from here; `historyStorage` handles lazy migration)
- All date arithmetic uses plain `Date` — no external date library

### 6.2 `src/screens/ReportsScreen.tsx`

**Layout:**
```
┌─────────────────────────────────┐
│ ← Reports        [Week|Month|Year]  │  ← tab strip
├─────────────────────────────────┤
│  ← September 2026 →             │  ← period navigation
├─────────────────────────────────┤
│  Summary Cards (2×2 grid)       │
│  [Total Words] [Total Notes]    │
│  [Avg Words]   [Top Hour]       │
├─────────────────────────────────┤
│  Daily Word Count (bar chart)   │  ← react-native-svg Rect primitives
├─────────────────────────────────┤
│  Tone Split (donut chart)       │  ← two-arc SVG
│  Language Breakdown (h-bars)    │
└─────────────────────────────────┘
```

**Chart implementation:** Pure `react-native-svg` — no additional charting library. SVG paths constructed from `PeriodStats` values in a pure helper `src/utils/chartHelpers.ts`. This keeps the bundle lean and dependency-free.

**Navigation entry point:** `HistoryScreen` header gains a 📊 icon button that navigates to `ReportsScreen`. Route added to `RootStackParamList`.

**Performance:** `computeStats` called inside `useEffect` wrapped in `InteractionManager.runAfterInteractions`. Result stored in `useState`; recomputed only when period, referenceDate, or history mutation changes.

---

## 7. UX Improvements

### 7.1 Animated Record Button

**File:** `src/components/AnimatedRecordButton.tsx` (replaces inline button in `HomeScreen`)

```
States:
  idle       → static mic icon, no animation
  recording  → 3 concentric pulsing rings (scale 1.0→1.3, opacity 1→0, 800ms loop)
  processing → rotating dashed arc border (360°, 1200ms loop)
  error      → red flash (400ms, 2 pulses)
```

Implementation: `Animated.loop` + `Animated.parallel` using React Native's built-in `Animated` API. No third-party animation library. All transforms use `useNativeDriver: true` for 60fps on the UI thread.

Haptics:
- Start recording: `impactHeavy`
- Stop recording: `impactMedium`
- Transcription complete: `notificationSuccess`
- Error: `notificationError`

### 7.2 History Search + FAB Filter

**Search bar (`src/components/HistorySearchBar.tsx`):**
- `TextInput` pinned below `Header` in `HistoryScreen`
- 200ms debounce via `useRef` timeout; filters on `finalText + rawText` (case-insensitive)
- "Clear" X button appears when text is non-empty
- Client-side filter on the local `records` array — no storage query needed

**FAB Filter (`src/components/HistoryFilterFAB.tsx`):**
- Floating button, bottom-right, 56×56 dp, primary colour
- On press: expands upward with a filter chip row (Animated.spring)
- Filter chips: `All | Pro | Casual | EN | HI | Today | This Week`
- Multiple chips selectable simultaneously (AND logic across categories, OR within)
- Active filter count shown as a badge on the FAB when collapsed
- Filter state: local `useState` in `HistoryScreen`; not persisted

**Combined filter + search logic:**
```typescript
const filteredRecords = useMemo(() => {
  return records
    .filter(r => matchesSearch(r, searchQuery))
    .filter(r => matchesFilters(r, activeFilters));
}, [records, searchQuery, activeFilters]);
```

### 7.3 Onboarding Wizard

**File:** `src/screens/OnboardingScreen.tsx`

Shown when `hasCompletedOnboarding === false` — routed via `AppNavigator` before `HomeScreen`.

**Slides:**

| # | Title | Content |
|---|---|---|
| 1 | Welcome to VoiceNote | Value proposition + privacy promise. "Your voice never leaves your device." |
| 2 | Download Models | Inline model download progress. Same `modelInstaller` calls as `ModelsScreen`. Required before proceeding (Next button disabled until ASR model installed; SLM model shows optional badge). |
| 3 | Your Defaults | Tone picker (Professional / Casual) + Language picker (English / Hindi / Auto). Writes to `useSettingsStore`. |
| 4 | Ready | Animated mic icon. "Tap the mic to record your first note." |

Navigation: `FlatList` horizontal pager (no third-party pager needed). Dots indicator at bottom. Skip button top-right on slide 1 only (skipping jumps to slide 4 but still requires model download).

On complete or skip-to-finish: `setHasCompletedOnboarding(true)` → navigate to `Home`.

### 7.4 In-App Theme Toggle

**`useSystemTheme()` hook extended:**
```typescript
// src/utils/theme.ts
function useSystemTheme(): Theme {
  const themeMode = useSettingsStore(s => s.themeMode);
  const systemColorScheme = useColorScheme(); // RN built-in
  
  const effectiveScheme =
    themeMode === 'system' ? systemColorScheme : themeMode;
  
  return effectiveScheme === 'dark' ? darkTheme : lightTheme;
}
```

**`SettingsScreen` — new "Appearance" section:**
```
Appearance
  [System] [Light] [Dark]   ← segmented control
```

Persisted via `useSettingsStore.setThemeMode(mode)` → MMKV.

---

## 8. Performance Hardening

### 8.1 Memory Budget — Chunked Recording

| Item | Size | Notes |
|---|---|---|
| Active PCM segment | ~960 KB | 30s × 16kHz × 2 bytes = 960,000 bytes |
| Overlap buffer | ~160 KB | 5s × 16kHz × 2 bytes |
| Peak (2 segments) | ~2.2 MB | Released after Whisper processes each |
| Whisper model (Q4) | ~75–150 MB | Already loaded, not counted here |
| SLM model (Q4_K_M) | ~350 MB | Already loaded, not counted here |
| **Total peak** | **~502 MB** | Within 500 MB limit; Whisper + SLM never both loaded simultaneously (existing constraint) |

### 8.2 Waveform Throttle

`src/components/Waveform.tsx` — amplitude update rate capped at 60ms minimum interval:
```typescript
const lastUpdateMs = useRef(0);
// In onFrame callback:
if (Date.now() - lastUpdateMs.current < 60) return;
lastUpdateMs.current = Date.now();
setDisplayAmplitude(amplitude);
```

### 8.3 History Date Index

`src/services/history/storage.ts` — secondary index maintained alongside records:
```typescript
// On saveRecord: insert [timestamp, id] into sorted index (binary insertion)
// On deleteRecord: remove entry from index
// On clearAll: reset index to []
// Persisted at MMKV key: 'vn_history_date_index'
```

Used by `statsEngine` to slice records by date range in O(log n) without scanning all 500.

### 8.4 Error Taxonomy Additions

**`src/ml/errors.ts` — new error codes:**

| Code | Trigger |
|---|---|
| `SEGMENT_MERGE_FAILED` | SegmentMerger couldn't align overlap after 3 fallback attempts |
| `RECORDING_LIMIT_REACHED` | 30-minute cap hit; recording auto-stopped |
| `HARDWARE_TRIGGER_DENIED` | OS rejected event listener registration (rare; permission edge case) |

---

## 9. File Map — New & Modified Files

### New Files

| File | Purpose |
|---|---|
| `src/audio/chunkedRecorder.ts` | Rolling 30s PCM window with overlap emission |
| `src/audio/segmentQueue.ts` | Sequential FIFO queue for segment-to-Whisper feeding |
| `src/audio/segmentMerger.ts` | Levenshtein overlap deduplication and transcript merge |
| `src/native/hardwareTrigger.ts` | JS bridge to native hardware button module |
| `src/services/doublePressDetector.ts` | Pure JS 400ms double-press detector |
| `src/services/statsEngine.ts` | Pure function: MMKV records → PeriodStats |
| `src/utils/chartHelpers.ts` | SVG path/rect helpers for ReportsScreen charts |
| `src/screens/ReportsScreen.tsx` | In-app stats dashboard (SVG charts) |
| `src/screens/OnboardingScreen.tsx` | First-run wizard (4 slides) |
| `src/components/AnimatedRecordButton.tsx` | Pulse/ripple/spin animated mic button |
| `src/components/HistorySearchBar.tsx` | Debounced search input for HistoryScreen |
| `src/components/HistoryFilterFAB.tsx` | Expandable filter chip FAB |
| `ios/VoiceNote/VoiceNoteHardwareTriggerModule.swift` | iOS native trigger (volume + headphone) |
| `android/app/src/main/java/.../VoiceNoteHardwareTriggerModule.kt` | Android native trigger (volume + headphone) |
| `tests/audio/chunkedRecorder.test.ts` | Unit tests for ChunkedRecorder |
| `tests/audio/segmentMerger.test.ts` | Unit tests for SegmentMerger (overlap dedup, edge cases) |
| `tests/services/statsEngine.test.ts` | Unit tests for statsEngine (all 3 periods, edge cases) |
| `tests/services/doublePressDetector.test.ts` | Unit tests for DoublePressDetector (timing edge cases) |
| `tests/screens/reportsScreen.test.ts` | Render + interaction tests for ReportsScreen |
| `tests/screens/onboardingScreen.test.ts` | Render + flow tests for OnboardingScreen |

### Modified Files

| File | Change |
|---|---|
| `src/services/history/types.ts` | Add `_v`, `wordCount`, `durationMs`, `segmentCount` fields |
| `src/services/history/storage.ts` | Increase cap 50→500; add date index; add lazy v1→v2 migration |
| `src/state/useSettingsStore.ts` | Add `hardwareTriggerButton`, `themeMode`, `maxHistoryRecords`, `hasCompletedOnboarding` |
| `src/ml/errors.ts` | Add 3 new error codes |
| `src/pipeline/orchestrator.ts` | Detect chunked input; drive SegmentQueue; call SegmentMerger |
| `src/screens/HomeScreen.tsx` | Replace record button with AnimatedRecordButton; wire useHardwareTrigger |
| `src/screens/HistoryScreen.tsx` | Add SearchBar, FilterFAB, 📊 nav button |
| `src/screens/SettingsScreen.tsx` | Add Hardware Trigger section + Appearance section |
| `src/navigation/AppNavigator.tsx` | Add OnboardingScreen (conditional root); add ReportsScreen |
| `src/navigation/routes.ts` | Add `Onboarding` and `Reports` routes |
| `src/utils/theme.ts` | `useSystemTheme` reads `themeMode` from settings store |
| `src/components/Waveform.tsx` | Add 60ms throttle on amplitude updates |

---

## 10. Testing Strategy

### Unit Tests (Jest / Node — no hardware required)
- `segmentMerger.test.ts` — exact overlap, partial overlap, no overlap, Hindi text, empty segments
- `statsEngine.test.ts` — empty history, single record, week boundary (Mon-Sun), month boundary, year boundary, mixed languages and tones, v1 record migration
- `doublePressDetector.test.ts` — single press (no trigger), double within window (trigger), double outside window (no trigger), triple press (second double triggers, third ignored)
- `chunkedRecorder.test.ts` — short recording (no chunking), exactly-at-threshold, long recording (3 segments), cancel mid-recording

### Integration Tests (pipeline)
- `orchestrator.test.ts` extended — single-segment path (existing), multi-segment chunked path (mock Whisper per segment)

### Component Tests (React Native Testing Library)
- `reportsScreen.test.ts` — renders with empty data, renders with fixture data, period navigation arrows, tab switching
- `onboardingScreen.test.ts` — slide progression, skip flow, model download gate (Next disabled until model installed)

### Manual QA Checklist (before merge)
- [ ] Record 35-second voice note; confirm merged transcript has no duplicate words at ~25s boundary
- [ ] Double-press volume button; confirm recording starts within 400ms
- [ ] Double-press headphone button; confirm recording starts within 400ms
- [ ] Navigate to Reports → Week; confirm word counts match history records
- [ ] Fresh install (or `hasCompletedOnboarding = false`): confirm onboarding displays, model download works, defaults persist
- [ ] Toggle theme Light/Dark/System in Settings; confirm all screens update correctly
- [ ] Search history for a known phrase; confirm matching records shown
- [ ] Filter history by 'Pro' tone; confirm only Professional records shown

---

## 11. Open Questions & Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Should the history cap (500) be user-configurable in Settings? | Yes — exposed as a numeric setting in `SettingsScreen` with presets 100 / 250 / 500 / Unlimited. |
| 2 | Should Reports be accessible from the bottom tab bar or just from History? | From History (📊 icon). Keeps nav simple; avoids adding a tab bar (which doesn't exist yet). |
| 3 | Word-count definition: raw or final text? | **Final text** (`finalText`) — that's what the user sees and what's meaningful for usage stats. |
| 4 | Should `themeMode` affect the onboarding screen too? | Yes — `useSystemTheme()` is used globally; onboarding inherits it automatically. |
| 5 | Power button — fully hidden or shown-but-disabled? | Shown, disabled, with tooltip "Not supported on this platform". Better UX than silently omitting it. |
