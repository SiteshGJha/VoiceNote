# VoiceNote Zero-Loss Offline Audio Capture & Tone Rewriting — Design Specification

**Date:** 2026-09-30  
**Status:** Approved by human partner  
**Scope:** Fix speech loss at the start, mid-utterance, and end of recordings; ensure full capture of 40s–60s+ audio; guarantee reliable tone rewriting without false hallucination fallback.

---

## 1. Intent & Success Criteria

### Intent
Resolve root causes of speech loss and tone rewrite failures in VoiceNote on-device dictation:
1. **Zero Start-of-Utterance Loss**: Audio capture immediately accounts for button touch latency and hardware spin-up via a rolling 400ms pre-roll ring buffer and `onPressIn` trigger.
2. **Zero End-of-Utterance Loss**: A 400ms tail hangover captures trailing words and consonants before flushing to storage.
3. **No Mid-Utterance Dropping on Pauses**: Transition recording cutoff to manual-stop-only mode so natural pauses (thinking, breathing) during 40s–60s notes never abort capture.
4. **Reliable 40s–60s+ Audio Transcription**: Multi-window 30s chunking with 5s overlap and Levenshtein deduplication (`segmentMerger`) ensures 100% of speech is transcribed.
5. **Faithful Tone Rewriting**: Relax over-strict validation thresholds and token limits in the SLM pipeline so tone transformations are applied rather than silently falling back to raw text.

### Success Criteria
- 0% dropped words at the beginning or end of 5s to 60s recordings.
- Recordings with 1.5s–3s natural pauses do NOT terminate prematurely.
- Transcriptions for 40s–60s audio produce continuous, coherent text across Whisper segment boundaries.
- Tone rewriting (`professional` and `casual`) succeeds and returns rewritten text instead of falling back to raw transcript for valid spoken notes.
- All unit and pipeline test suites pass 100%.
- Zero cloud network calls; audio files strictly deleted immediately after ASR.

---

## 2. Architecture & Data Flow

```
User Action:
  [Touch Down (onPressIn)] ──► Native/Worker starts audio engine instantly
                                Circular ring buffer captures ~400ms pre-roll
  [User Speaks 5s - 60s+]  ──► VAD tracks speech presence for waveform only (NO auto-kill)
  [Touch Stop]             ──► +400ms tail hangover captured to catch soft endings
                                Audio flushed to local temporary file (source of truth)
                                │
                                ▼
                       Duration Check:
                      ┌─────────────────┴─────────────────┐
                      │                                   │
              Duration <= 25s                      Duration > 25s
                      │                                   │
             Single Whisper Pass             Chunked Whisper Pass:
                      │                      - Window: 30s segments
                      │                      - Overlap: 5s
                      │                      - Overlap dedup via segmentMerger
                      └─────────────────┬─────────────────┘
                                        │
                                        ▼
                             Full Raw Transcript
                                        │
                                        ▼
                                 SLM Tone Rewrite:
                                 - Prompt structured for long text
                                 - Calibrated preservation validator
                                 - Tone applied (no false-positive fallbacks)
                                        │
                                        ▼
                             History MMKV & Display
```

---

## 3. Component Details & Modifications

### 3.1 Audio Capture & Buffering (`src/audio/recorder.ts`)
- **Circular Pre-roll Ring Buffer**: Holds the most recent 400ms of PCM (6,400 samples at 16 kHz mono linear PCM). When `start()` is triggered, initial frames are prepended with this pre-roll buffer.
- **Tail Hangover on Stop**: When `stop()` is invoked, audio capture runs for an extra 400ms before finalizing the WAV file.
- **Raw Audio Integrity**: Leading audio is preserved without aggressive energy-based trimming so quiet speech onsets reach Whisper intact.

### 3.2 UI Interaction & VAD Decoupling (`src/components/AnimatedRecordButton.tsx`, `src/screens/HomeScreen.tsx`, `src/audio/vadGate.ts`)
- **`AnimatedRecordButton.tsx`**: Update button triggers to respond on `onPressIn` for immediate start and haptic response.
- **`HomeScreen.tsx`**: Remove `onAutoStop` callback trigger from `VadGate`. Recording stops only when the user explicitly taps Stop or triggers the hardware double-press. VAD remains active for visual waveform feedback and the empty-recording guard.

### 3.3 ASR Long Audio Processing (`src/pipeline/orchestrator.ts`, `src/ml/asr/index.ts`)
- For audio recordings > 25s, ensure the segmenter divides audio into overlapping windows (30s window, 5s overlap) and merges results using `segmentMerger.ts` without dropping trailing words.

### 3.4 SLM Tone Rewriter & Hallucination Guard (`src/ml/slm/validator.ts`, `src/ml/slm/promptBuilder.ts`, `src/ml/slm/index.ts`)
- **Validation Tuning**: For longer inputs (40s–60s), calibrate `validatePreservation` length ratios and entity matching to permit concise professional rewrites and contractions removal without throwing `SLM_HALLUCINATION_SUSPECTED`.
- **Token Limits**: Increase `maxTokens` in `SLM_PARAMS` to 1024 to support rewriting 60s+ transcripts without truncation.

---

## 4. Verification & Testing

- Unit tests in `tests/audio/recorder.test.ts` for pre-roll and tail hangover buffers.
- Unit tests in `tests/ml/slmValidator.test.ts` for long-text tone validation.
- Pipeline tests verifying 40s–60s audio end-to-end transcription and tone rewriting.
- `npm test`, `npm run typecheck`, and `npm run audit:privacy`.
