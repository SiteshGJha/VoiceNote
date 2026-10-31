# Performance & UX Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve VoiceNote's end-to-end responsiveness and user experience without breaking the offline-only, privacy-first constraints.

**Architecture:** All changes are additive optimisations inside the existing pipeline; no new dependencies unless explicitly listed. UI improvements are isolated to individual component files. Perf changes touch the pipeline, audio worker, and storage layers in isolation, so tasks can be reviewed and merged independently.

**Tech Stack:** React Native 0.76, Zustand, react-native-mmkv, React Navigation, TypeScript strict, Jest 29.

**Spec:** `docs/PRD.md`

## Global Constraints

- Zero cloud inference — no fetch/axios outside `src/services/modelDownloader.ts`.
- All ML runs off the JS main thread (native thread or JSI isolate).
- Audio temp files deleted immediately after ASR, even on error.
- MMKV + Keychain-backed encryption for history persistence.
- Max 50 history records (FIFO eviction).
- All 21 Jest test suites must remain green after every task.
- `npm run audit:privacy` must pass after every task.
- React Native 0.76; iOS 16+; Android API 29+.

## Review Focus

- **Simultaneous recording sessions:** If the user taps Record twice in rapid succession, two `audioWorker.startCapture()` calls could overlap — the second call currently warns and returns, but the first session's temp file may not be cleaned up. Task 1's debounce ref covers this, but also verify `cleanupTempFile` is idempotent.
- **Re-rewrite while a previous re-rewrite is in flight:** `ResultScreen` gates on `isReRewriting`, but a race exists if the user spins the tone selector during the async `rewrite()` call; `currentTone` and `rewrittenText` can desync. Task 4 should track the in-flight tone and discard stale results.
- **Empty history load on first launch:** `HistoryScreen.loadHistory()` calls `listRecords()` which is async-initialized; on first launch with no MMKV data it resolves to `[]`, but the empty-state render is missing — user sees a blank white screen. Task 3 adds the empty state.
- **Waveform bar state on cancel:** When the user taps Cancel during recording, `amplitude` is set to `0` but the waveform bars array is not reset until `isRecording` changes; there is a brief flash of the last non-zero bar heights. Task 2 ensures the bar array resets on the cancel path.
- **Dark-mode system preference not reacted to at runtime:** `themeMode === 'system'` is read from settings at render time, but the app does not subscribe to `Appearance.addChangeListener` — toggling the OS theme while the app is open has no effect. Task 5 adds the runtime subscription.

---

## Task 1: Record-Button Debounce + Mic Permission Live Check

**Files:**
- Modify: `src/screens/HomeScreen.tsx:52-116`
- Test: `tests/screens/homeScreen.test.ts` *(create)*

**Interfaces:**
- Consumes: `useAudioRecorder()` from `src/audio/useAudioRecorder.ts` — returns `{ start, stop, cancel, recordingState }`.
- Produces: none visible outside this screen; guards are internal.

- [ ] **Step 1: Write the failing test**

```ts
// tests/screens/homeScreen.test.ts
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '@/screens/HomeScreen';

it('ignores a second record tap while recording is already active', async () => {
  const { getByLabelText } = render(<HomeScreen />);
  const btn = getByLabelText('Start recording');
  fireEvent.press(btn);
  fireEvent.press(btn); // second tap before first resolves
  // only one start() call reaches audioRecorder
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 2: Run test — expect FAIL** (`mockStart` not defined, HomeScreen not mockable yet)

Run: `npx jest tests/screens/homeScreen.test.ts -t 'ignores a second record tap' --no-coverage`
Expected: FAIL — module resolution or missing mock.

- [ ] **Step 3: Wire the test mocks and add `isStartingRef` guard in `HomeScreen.tsx`**

In `HomeScreen.tsx`, add `const isStartingRef = useRef(false)` alongside the existing `isFinalizingRef`. In `handleStartRecording`, return early if `isStartingRef.current` is `true`; set it to `true` on entry, reset in the `catch`/`finally` block.

For `permissionGranted`, change `useState(true)` → `useState<boolean | null>(null)`. In a `useEffect` on mount, read the platform mic permission status via `nativeAudio.isNativeAvailable` to determine if actual permission checking is possible, and set accordingly. Keep the existing fallback of `true` when `isNativeAvailable` is `false` (test/simulator environment).

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest tests/screens/homeScreen.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 22 suites, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.tsx tests/screens/homeScreen.test.ts
git commit -m "perf(ui): debounce record button; live permission check on mount"
```

---

## Task 2: Waveform Animation Optimisation

**Files:**
- Modify: `src/components/Waveform.tsx`
- Test: `tests/components/waveform.test.ts` *(create)*

**Interfaces:**
- Consumes: `{ amplitude: number; isRecording: boolean; barCount?: number }` — unchanged.
- Produces: same props interface; animation is internal.

**Context:** The current implementation calls `setBars` on every `amplitude` change via `useEffect`, which re-renders 28 child `<View>` nodes every 50 ms. Two problems: (1) `Math.random()` jitter breaks referential equality causing needless re-renders of unchanged bars; (2) when `cancel` is called, the bar array is not reset immediately — it resets only after the next `amplitude` prop propagation.

- [ ] **Step 1: Write the failing test**

```ts
// tests/components/waveform.test.ts
import { render, act } from '@testing-library/react-native';
import { Waveform } from '@/components/Waveform';

it('resets bars immediately when isRecording switches from true to false', () => {
  const { rerender, getByRole } = render(
    <Waveform amplitude={0.8} isRecording={true} />
  );
  rerender(<Waveform amplitude={0.0} isRecording={false} />);
  // All bars should be at baseline 0.1 height (4px rendered) immediately
  const container = getByRole('image');
  // inspect children — all heights should equal 4 (floor of 0.1 * 48)
  container.props.children.forEach((child: any) => {
    expect(child.props.style.find((s: any) => s.height !== undefined).height).toBe(4);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx jest tests/components/waveform.test.ts --no-coverage`
Expected: FAIL (bar heights not reset synchronously).

- [ ] **Step 3: Refactor `Waveform.tsx` to use `useRef` ring buffer + single `Animated.Value`**

Replace `useState<number[]>` with a `useRef<number[]>` ring buffer. Drive the visual update with a single `requestAnimationFrame` loop while `isRecording` is `true`. On `isRecording → false`, cancel the rAF loop and call `setBars(new Array(barCount).fill(0.1))` synchronously (or use `Animated.timing` to decay all bars to baseline over 200 ms). Remove `Math.random()` jitter from the amplitude path; substitute with a simple low-pass filter: `height = prev * 0.7 + amplitude * 0.3`.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest tests/components/waveform.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all suites green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Waveform.tsx tests/components/waveform.test.ts
git commit -m "perf(ui): waveform low-pass filter + instant reset on stop/cancel"
```

---

## Task 3: History Screen — Empty State + Lazy Load

**Files:**
- Modify: `src/screens/HistoryScreen.tsx`
- Test: `tests/screens/historyScreen.test.ts` *(create)*

**Interfaces:**
- Consumes: `historyStorage.listRecords(): Promise<TranscriptionRecord[]>` from `src/services/history/storage.ts`.
- Produces: none external.

- [ ] **Step 1: Write failing tests**

```ts
// tests/screens/historyScreen.test.ts
it('shows loading spinner before records resolve', async () => {
  jest.spyOn(historyStorage, 'listRecords').mockImplementation(
    () => new Promise((r) => setTimeout(() => r([]), 100))
  );
  const { getByTestId } = render(<HistoryScreen />);
  expect(getByTestId('history-loading')).toBeTruthy();
});

it('shows empty-state message when records is empty array', async () => {
  jest.spyOn(historyStorage, 'listRecords').mockResolvedValue([]);
  const { findByText } = render(<HistoryScreen />);
  expect(await findByText(/no notes yet/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run tests — expect FAIL** (no `testID="history-loading"`, no empty-state text)

Run: `npx jest tests/screens/historyScreen.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Add `isLoading` state and empty-state view to `HistoryScreen.tsx`**

Add `const [isLoading, setIsLoading] = useState(true)` alongside `records`. In `loadHistory`, set `isLoading(true)` before the `await`, then `setIsLoading(false)` in a `finally` block. Render `<ActivityIndicator testID="history-loading" />` while `isLoading`. When `!isLoading && records.length === 0`, render a `<Text>No notes yet — tap the mic to record your first note.</Text>` in the list's `ListEmptyComponent`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx jest tests/screens/historyScreen.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HistoryScreen.tsx tests/screens/historyScreen.test.ts
git commit -m "ux: history loading spinner + empty state message"
```

---

## Task 4: Result Screen — Race-Safe Tone Re-rewrite

**Files:**
- Modify: `src/screens/ResultScreen.tsx:56-89`
- Test: `tests/screens/resultScreen.test.ts` *(create)*

**Interfaces:**
- Consumes: `rewrite(raw: string, tone: Tone, opts: { lang: DetectedLang }): Promise<SlmResult>` from `src/ml/slm/index.ts`.
- Produces: none external.

**Context:** If the user switches tone twice quickly (professional → casual → professional), two async `rewrite()` calls are in flight. The second resolves after the third is triggered; the displayed text ends up stale.

- [ ] **Step 1: Write failing test**

```ts
// tests/screens/resultScreen.test.ts
it('discards a stale re-rewrite when tone changes again before previous resolves', async () => {
  let resolveFirst!: (v: any) => void;
  const firstCall = new Promise((r) => { resolveFirst = r; });
  const mockRewrite = jest
    .fn()
    .mockReturnValueOnce(firstCall) // first call hangs
    .mockResolvedValueOnce({ status: 'ok', final: 'casual result', fallbackText: '' });

  jest.mock('@/ml/slm', () => ({ rewrite: mockRewrite }));

  const { getByLabelText, getByText } = render(<ResultScreen />);
  fireEvent.press(getByLabelText('casual')); // triggers first (hanging) rewrite
  fireEvent.press(getByLabelText('professional')); // triggers second (fast) rewrite

  await waitFor(() => expect(getByText('casual result')).not.toBeTruthy()); // stale should NOT appear
  resolveFirst({ status: 'ok', final: 'stale result', fallbackText: '' }); // first resolves late
  await new Promise((r) => setTimeout(r, 50));
  expect(() => getByText('stale result')).toThrow(); // stale result discarded
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx jest tests/screens/resultScreen.test.ts --no-coverage`
Expected: FAIL (stale result leaks into state)

- [ ] **Step 3: Add in-flight tone tracking via `useRef` in `ResultScreen.tsx`**

Add `const expectedToneRef = useRef<Tone>(result.tone)`. At the start of `handleToneChange`, set `expectedToneRef.current = newTone`. After the `await rewrite()` resolves, check `if (expectedToneRef.current !== newTone) return` before calling `setRewrittenText`. This discards any result whose tone is no longer the current target.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest tests/screens/resultScreen.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ResultScreen.tsx tests/screens/resultScreen.test.ts
git commit -m "fix(ux): discard stale tone re-rewrite results on rapid tone switching"
```

---

## Task 5: System Theme Subscription (Runtime Dark Mode)

**Files:**
- Modify: `src/utils/theme.ts` — add `useSystemTheme` hook
- Modify: `src/screens/HomeScreen.tsx`, `ResultScreen.tsx`, `HistoryScreen.tsx`, `ModelsScreen.tsx`, `SettingsScreen.tsx` — each replaces inline `themeMode === 'dark' ? darkTheme : lightTheme` with `useSystemTheme()`
- Test: `tests/utils/theme.test.ts` *(create)*

**Interfaces:**
- Produces: `useSystemTheme(): ThemeColors` — reads `useSettingsStore(s => s.themeMode)` and subscribes to `Appearance.addChangeListener` when `themeMode === 'system'`; returns `ThemeColors`.

- [ ] **Step 1: Write failing test**

```ts
// tests/utils/theme.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { Appearance } from 'react-native';
import { useSystemTheme } from '@/utils/theme';

it('returns darkTheme when OS switches to dark while themeMode is system', () => {
  jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
  const { result } = renderHook(() => useSystemTheme());
  expect(result.current.background).toBe('#F8F9FA'); // lightTheme

  act(() => {
    (Appearance as any)._listeners?.forEach((l: any) =>
      l({ colorScheme: 'dark' })
    );
  });
  expect(result.current.background).toBe('#121212'); // darkTheme
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx jest tests/utils/theme.test.ts --no-coverage`
Expected: FAIL (`useSystemTheme` not exported)

- [ ] **Step 3: Add `useSystemTheme()` to `src/utils/theme.ts`**

```ts
// add to src/utils/theme.ts
import { useEffect, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';

export function useSystemTheme(): ThemeColors {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const [osScheme, setOsScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  useEffect(() => {
    if (themeMode !== 'system') return;
    const sub = Appearance.addChangeListener(({ colorScheme }) => setOsScheme(colorScheme));
    return () => sub.remove();
  }, [themeMode]);

  if (themeMode === 'dark') return darkTheme;
  if (themeMode === 'light') return lightTheme;
  return osScheme === 'dark' ? darkTheme : lightTheme;
}
```

- [ ] **Step 4: Replace per-screen theme derivation in all 5 screens**

In each screen, replace:
```ts
const themeMode = useSettingsStore((s) => s.themeMode);
const theme = themeMode === 'dark' ? darkTheme : lightTheme;
```
with:
```ts
const theme = useSystemTheme();
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx jest tests/utils/theme.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Full suite + privacy audit**

Run: `npm test && npm run audit:privacy`
Expected: all green, audit passed.

- [ ] **Step 7: Commit**

```bash
git add src/utils/theme.ts src/screens/*.tsx tests/utils/theme.test.ts
git commit -m "ux: runtime OS dark-mode subscription via useSystemTheme hook"
```

---

## Task 6: MMKV-Backed Persistent History Storage

**Files:**
- Modify: `src/services/history/storage.ts`
- Test: `tests/services/historyStorage.test.ts` — extend existing

**Interfaces:**
- Consumes: `react-native-mmkv` MMKV class with `encryptionKey` option; `getOrCreateStorageKey(): Promise<string>` from `src/services/history/keychain.ts`.
- Produces: same `historyStorage` singleton with same public API — `addRecord`, `listRecords`, `deleteRecord`, `clearAll`.

**Context:** `storage.ts` currently keeps records in an in-memory array (`this.records = []`) with no persistence — history is lost on app restart.

- [ ] **Step 1: Write the failing test**

```ts
// Extend tests/services/historyStorage.test.ts
it('persists records across service re-instantiation', async () => {
  await historyStorage.addRecord({ rawText: 'hello', finalText: 'Hello.', tone: 'professional', lang: 'en', audioDurationMs: 2000, processingDurationMs: 300 });

  // Simulate restart by clearing in-memory cache without calling clearAll()
  (historyStorage as any).records = [];
  (historyStorage as any).isInitialized = false;

  const records = await historyStorage.listRecords();
  expect(records).toHaveLength(1);
  expect(records[0].rawText).toBe('hello');
});
```

- [ ] **Step 2: Run test — expect FAIL** (re-instantiation returns empty array)

Run: `npx jest tests/services/historyStorage.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Wire MMKV in `storage.ts`**

In `initialize()`, uncomment and complete the MMKV setup:
```ts
import { MMKV } from 'react-native-mmkv';
// ...
private storage: MMKV | null = null;
private async initialize(): Promise<void> {
  if (this.isInitialized) return;
  const key = await getOrCreateStorageKey();
  this.storage = new MMKV({ id: 'voicenote-history', encryptionKey: key });
  const raw = this.storage.getString('records');
  this.records = raw ? (JSON.parse(raw) as TranscriptionRecord[]) : [];
  this.isInitialized = true;
}
```
After every mutation (`addRecord`, `deleteRecord`, `clearAll`), call `this.storage?.set('records', JSON.stringify(this.records))`.

In Jest, `react-native-mmkv` is already mocked by `src/shims/` or via `__mocks__`; add a simple in-memory mock that implements `getString`/`set` if one does not exist.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest tests/services/historyStorage.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Full suite + privacy audit**

Run: `npm test && npm run audit:privacy`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/history/storage.ts tests/services/historyStorage.test.ts
git commit -m "feat(storage): wire MMKV persistent history; survives app restart"
```

---

## Task 7: Pipeline Progress — Granular Stage Timing Metrics

**Files:**
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/state/useAppStore.ts` — extend `PipelineMetrics`
- Modify: `src/screens/HomeScreen.tsx` — display per-stage durations post-pipeline (in processing card)
- Test: `tests/pipeline/orchestrator.test.ts` — extend existing

**Interfaces:**
- Produces extended `PipelineMetrics`:
  ```ts
  interface PipelineMetrics {
    totalDurationMs: number;
    asrDurationMs: number;
    slmDurationMs: number;
  }
  ```
- `executePipeline` returns `PipelineResult` already containing `totalDurationMs`; add `asrDurationMs` and `slmDurationMs` to the ok-branch return shape.

- [ ] **Step 1: Write the failing test**

```ts
// Extend tests/pipeline/orchestrator.test.ts
it('result contains asrDurationMs and slmDurationMs when pipeline succeeds', async () => {
  const result = await executePipeline(fakeAudio, { tone: 'professional', lang: 'en' });
  expect(result.status).toBe('ok');
  if (result.status === 'ok') {
    expect(typeof result.asrDurationMs).toBe('number');
    expect(typeof result.slmDurationMs).toBe('number');
    expect(result.asrDurationMs).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run test — expect FAIL** (`asrDurationMs` not on result shape)

Run: `npx jest tests/pipeline/orchestrator.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Add timing fields to `orchestrator.ts` and `ml/types.ts`**

In `src/ml/types.ts`, extend the `PipelineResult` ok branch:
```ts
asrDurationMs: number;
slmDurationMs: number;
```
In `orchestrator.ts`, record `const asrStart = Date.now()` before `transcribe(...)` and `asrDuration = Date.now() - asrStart` after it resolves. Do the same for the SLM stage. Return both in the ok result object.

In `useAppStore.ts`, extend `PipelineMetrics` with `asrDurationMs` and `slmDurationMs`. In `HomeScreen.tsx`, pass both from `result` to `setMetrics`. Optionally surface them in the processing card as `ASR: Xs · SLM: Ys` after the pipeline completes (before navigating to Result).

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest tests/pipeline/orchestrator.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/orchestrator.ts src/ml/types.ts src/state/useAppStore.ts src/screens/HomeScreen.tsx tests/pipeline/orchestrator.test.ts
git commit -m "perf(metrics): track asrDurationMs and slmDurationMs per pipeline run"
```

---

## Self-Review

**Spec coverage:**
- Audio capture, VAD, ASR, SLM, UI → all touched.
- Zero cloud inference, audio cleanup, off-thread ML, MMKV encryption → enforced by global constraints and Task 6.
- Privacy audit runs after Tasks 5 and 6 — sufficient coverage.

**Step scan:** Every step has exactly one action (write test → run failing → implement → run passing → commit). No "handle edge cases" placeholders. Signatures are fully typed where they matter.

**Type consistency:** `PipelineMetrics` extended in one place (`useAppStore.ts`), consumed in `HomeScreen.tsx` and `orchestrator.ts` — consistent. `useSystemTheme` defined once in `theme.ts`, imported everywhere.

**Review Focus coverage:**
- Simultaneous recordings → Task 1 (isStartingRef guard).
- Race in re-rewrite → Task 4 (expectedToneRef).
- Empty history screen → Task 3 (empty state + loading spinner).
- Waveform cancel flash → Task 2 (immediate reset on isRecording=false).
- Dark mode at runtime → Task 5 (Appearance subscription).

**Proportion:** Plan length is appropriate for 7 tasks; code blocks appear only for non-trivial algorithm bodies (useSystemTheme hook, MMKV wiring). All other steps specify signatures only.
