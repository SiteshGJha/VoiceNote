# Zero-Loss Offline Audio Capture & Tone Rewriting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate speech loss at the start, middle, and end of dictation recordings, support continuous 40s–60s+ audio transcription without truncation, and ensure SLM tone rewriting reliably applies without false hallucination fallback.

**Architecture:** Add a 400ms circular pre-roll ring buffer and 400ms tail hangover to the audio capture layer; decouple VAD auto-stop from manual dictation so pauses do not cut off recordings; ensure long audio is segmented and merged across 30s Whisper windows; and calibrate SLM validation and token limits for long speech notes.

**Tech Stack:** React Native, TypeScript, Jest, Whisper native bridge, GGUF/llama.rn bridge, WebRTC VAD.

**Spec:** `docs/superpowers/specs/2026-09-30-audio-capture-hardening-design.md`

## Global Constraints

- Zero cloud inference. Audio never leaves the device.
- Audio temp files are strictly deleted immediately post-ASR.
- ML inference runs off the JS main thread.
- TypeScript everywhere with strict type checking (`npm run typecheck`).
- All Jest test suites must pass 100%.

## Review Focus

1. Starting speech immediately upon pressing the record button must retain initial phonemes via pre-roll.
2. Ending speech right as the button is tapped must retain final words via 400ms tail hangover.
3. Natural pauses (1.5s–3s) in a 40s–60s note must not trigger premature recording termination.
4. Audio > 25s must not be truncated at Whisper's 30s context window.
5. SLM tone rewriting on a long paragraph must apply tone without failing validation or silently returning raw text.

---

### Task 1: Pre-Roll Ring Buffer & Tail Hangover in Audio Recorder

**Files:**
- Modify: `src/audio/recorder.ts`
- Test: `tests/audio/recorder.test.ts`

**Interfaces:**
- Consumes: `wrapPcmWithWavHeader`, `calculateDurationMs`, `SAMPLE_RATE` from `src/audio/wavUtils.ts`
- Produces: `audioRecorder.start()`, `audioRecorder.stop()`, `audioRecorder.pushFrame()` with 400ms pre-roll and 400ms tail hangover support.

- [ ] **Step 1: Write the failing test**

In `tests/audio/recorder.test.ts`, add test cases for pre-roll retention and tail hangover:
```typescript
it('prepends pre-roll audio frames captured prior to explicit start', async () => {
  // Push 400ms of frames while idle
  // Call start()
  // Push recording frames
  // Call stop()
  // Verify byte length includes pre-roll buffer
});

it('applies tail hangover delay before finalizing stop', async () => {
  // Verify stop() allows trailing audio buffer flush before returning
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/audio/recorder.test.ts`
Expected: FAIL on new assertions.

- [ ] **Step 3: Implement Pre-Roll & Tail Hangover in `src/audio/recorder.ts`**

1. Maintain a circular ring buffer of 400ms (6,400 bytes at 16 kHz 16-bit mono).
2. When frames arrive via `pushFrame` while idle, store them in the ring buffer.
3. On `start()`, prepend the circular buffer contents to `pcmChunks`.
4. On `stop()`, introduce a 400ms tail hangover delay to allow the last in-flight frames to be written before sealing the WAV file.
5. Avoid aggressive energy-based silence trimming that cuts soft leading phonemes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/audio/recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/recorder.ts tests/audio/recorder.test.ts
git commit -m "feat(audio): add 400ms pre-roll and tail hangover to audio recorder"
```

---

### Task 2: Touch-Down Trigger & VAD Decoupling in UI

**Files:**
- Modify: `src/components/AnimatedRecordButton.tsx`
- Modify: `src/screens/HomeScreen.tsx`
- Test: `tests/screens/homeScreen.test.ts`

**Interfaces:**
- Consumes: `onPressIn` / `onPress` props, `VadGate` callbacks
- Produces: Immediate recording start on touch down; manual-stop-only recording cycle.

- [ ] **Step 1: Write the failing test**

In `tests/screens/homeScreen.test.ts`, verify that `onAutoStop` from `VadGate` does not cut off recording, and `AnimatedRecordButton` handles `onPressIn` for responsive touch start.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/screens/homeScreen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `AnimatedRecordButton.tsx` and `HomeScreen.tsx`**

1. In `AnimatedRecordButton.tsx`:
   - Support `onPressIn` so microphone capture spins up immediately on touch down.
2. In `HomeScreen.tsx`:
   - Remove `onAutoStop` calling `handleStopRecordingRef.current?.()`.
   - Keep VAD active for waveform display and for checking if the entire note was 100% silent.
   - Recording stops ONLY on user tap or hardware trigger.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/screens/homeScreen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AnimatedRecordButton.tsx src/screens/HomeScreen.tsx tests/screens/homeScreen.test.ts
git commit -m "feat(ui): responsive touch-down recording and manual-stop-only dictation"
```

---

### Task 3: Continuous Long-Audio Transcription (>25s)

**Files:**
- Modify: `src/ml/asr/index.ts`
- Modify: `src/pipeline/orchestrator.ts`
- Test: `tests/ml/asrPipeline.test.ts`

**Interfaces:**
- Consumes: `computeSegmentBoundaries` from `src/ml/asr/segmenter.ts`, `mergeSegments` from `src/audio/segmentMerger.ts`
- Produces: `transcribe()` and `executePipeline()` handling audio > 25s without truncation.

- [ ] **Step 1: Write the failing test**

In `tests/ml/asrPipeline.test.ts`, add a test transcribing a simulated 45-second audio file:
```typescript
it('transcribes audio longer than 30s without truncating trailing speech', async () => {
  // Transcribe 45s WAV
  // Verify all segments are transcribed and stitched together
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/ml/asrPipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Robust Long-Audio Slicing and Merging**

1. In `src/ml/asr/index.ts` and `src/ml/asr/segmenter.ts`:
   - For audio longer than 25 seconds, slice into 25s chunks with 5s overlap.
   - Ensure `findSilenceGaps` doesn't cut words in continuous speech if no silence is detected (fallback to sliding window).
   - Use `mergeSegments` to align overlap tokens with Levenshtein tolerance.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/ml/asrPipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ml/asr/index.ts src/ml/asr/segmenter.ts src/pipeline/orchestrator.ts tests/ml/asrPipeline.test.ts
git commit -m "fix(asr): ensure continuous 40s-60s+ audio transcription without truncation"
```

---

### Task 4: SLM Tone Rewriting & Hallucination Guard Calibration

**Files:**
- Modify: `src/ml/slm/validator.ts`
- Modify: `src/ml/slm/promptBuilder.ts`
- Modify: `src/ml/slm/index.ts`
- Test: `tests/ml/slmValidator.test.ts`

**Interfaces:**
- Consumes: `validatePreservation(raw, final)`, `buildPrompt(rawText, tone, lang)`
- Produces: Reliable tone rewriting without false-positive `SLM_HALLUCINATION_SUSPECTED` fallbacks.

- [ ] **Step 1: Write the failing test**

In `tests/ml/slmValidator.test.ts`, add test cases for longer transcripts (50–100 words) where contractions are expanded/removed or filler words stripped:
```typescript
it('validates legitimate tone rewrites of long text without false hallucination rejection', () => {
  const raw = 'Um so we need to schedule the quarterly planning meeting on October 15th at 3pm with Sarah and John to review the Q3 budget.';
  const final = 'We need to schedule the quarterly planning meeting on October 15 at 3:00 PM with Sarah and John to review the Q3 budget.';
  const result = validatePreservation(raw, final);
  expect(result.isValid).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/ml/slmValidator.test.ts`
Expected: FAIL if strict entity or length boundary rejects natural rewrites.

- [ ] **Step 3: Implement SLM Validation & Parameter Calibration**

1. In `src/ml/slm/promptBuilder.ts`:
   - Increase `maxTokens` to 1024 for `SLM_PARAMS` to accommodate 60s+ transcripts without truncation.
2. In `src/ml/slm/validator.ts`:
   - Calibrate entity matching: allow standard entity formats (e.g. `3pm` vs `3:00 PM`, `15th` vs `15`).
   - Relax length ratio bounds for long text (0.35x to 2.5x) to accommodate concise professional summaries.
3. In `src/ml/slm/index.ts`:
   - Ensure detailed logging on validation failure so any future fallback is explicitly traceable.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/ml/slmValidator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ml/slm/validator.ts src/ml/slm/promptBuilder.ts src/ml/slm/index.ts tests/ml/slmValidator.test.ts
git commit -m "fix(slm): calibrate entity preservation and token limits for long transcripts"
```

---

### Task 5: End-to-End Pipeline & Integrity Verification

**Files:**
- Test: `tests/pipeline/orchestrator.test.ts`
- Verification: Entire test suite, type check, privacy audit

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All test suites PASS.

- [ ] **Step 2: Run type check**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run privacy audit**

Run: `npm run audit:privacy`
Expected: 0 violations.

- [ ] **Step 4: Final verification commit**

```bash
git add .
git commit -m "chore: verify zero-loss audio capture and tone rewriting pipeline"
```
