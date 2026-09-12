---
name: perf-profiling
description: >
  Profiles and optimizes VoiceNote's end-to-end latency, memory, and battery
  on iOS and Android. Use when a pipeline stage is too slow, RAM spikes,
  or the UI drops frames during inference.
---

# Performance Profiling Skill

## When to use this skill
- End-to-end latency exceeds 2 s for 5 s of audio.
- Peak RAM exceeds 500 MB.
- UI jank during transcription or rewriting.
- Battery drain per session exceeds 3% per 10 runs.

## Target metrics
| Metric | Target | Where measured |
|---|---|---|
| Cold start | < 2 s | `App.tsx` first render |
| ASR RTF | < 0.5 flagship / < 1.0 mid | `src/ml/asr/perf.ts` |
| SLM tok/s | > 15 | `src/ml/slm/perf.ts` |
| End-to-end (5 s) | < 2 s | `src/pipeline/perf.ts` |
| Peak RAM | < 500 MB | Instruments / Android Profiler |
| Frames > 100 ms | 0 | Perf monitor |

## Instrumentation
Wrap every pipeline stage with `measure()`:
```ts
import { measure } from '@/perf';

const result = await measure('asr', () => transcribe(uri, { lang }));
// logs { stage: 'asr', ms: 812, rssDelta: 142_000 }
```
Perf events are kept in an in-memory ring buffer (last 200) and never sent
off-device.

## Profiling recipes

### iOS
1. Xcode → Instruments → Time Profiler + Allocations.
2. Filter by `whisper` / `llama` symbol.
3. Check that inference is off the main thread (look for the
   `com.facebook.react.JavaScript` thread being idle).

### Android
1. Android Studio → Profiler → CPU + Memory.
2. Use `Debug.startMethodTracing` around the native inference call.
3. Verify no `Choreographer` skipped-frames warnings during inference.

## Optimization playbook (in order)
1. **VAD trim** — never send silence to ASR.
2. **Smaller quant** — Q4 before Q5 before Q8.
3. **Model tier** — Tiny → Base → Small.
4. **Unload between runs** — free model after 60 s idle.
5. **Batch** — rewrite only once, after ASR is final.
6. **Metal / NNAPI** — enable hardware accel behind a flag.

## Anti-patterns
- ❌ Optimizing without a baseline measurement.
- ❌ Caching a model just to avoid reload, when RAM is the bottleneck.
- ❌ Using `setTimeout`-based "async" that still blocks native.
