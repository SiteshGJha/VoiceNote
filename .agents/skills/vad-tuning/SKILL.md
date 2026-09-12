---
name: vad-tuning
description: >
  Tunes or debugs Voice Activity Detection in VoiceNote. Use when recording
  does not stop on silence, cuts off speech, or when adjusting sensitivity
  thresholds for different environments.
---

# VAD Tuning Skill

## When to use this skill
- Auto-stop fires too early or too late.
- Speech is being trimmed off the start or end.
- Adding a new VAD sensitivity preset.
- Debugging VAD behavior on a specific device or environment.

## Architecture
```
[mic frames @ 20–30 ms]
        │
        ▼
[react-native-nitro-webrtc-vad] → per-frame speech probability
        │
        ▼
[src/audio/vadGate.ts] → state machine
        │
        ├── state: 'idle' | 'speech' | 'silence'
        ├── on silence > threshold → emit 'auto-stop'
        └── trim leading/trailing silence → emit trimmed buffer
```

## Parameters
| Param | Default | Range | Notes |
|---|---|---|---|
| `frameMs` | 30 | 10–30 | Lower = more responsive, more CPU |
| `speechThreshold` | 0.5 | 0.3–0.7 | Probability above which a frame is speech |
| `silenceWindowMs` | 1500 | 500–3000 | Silence duration before auto-stop |
| `minSpeechMs` | 300 | 100–1000 | Minimum speech to consider a valid utterance |
| `paddingMs` | 200 | 0–500 | Audio kept before/after detected speech |

## Sensitivity presets
```ts
export const VAD_PRESETS = {
  low:    { speechThreshold: 0.6, silenceWindowMs: 2000 }, // noisy rooms
  medium: { speechThreshold: 0.5, silenceWindowMs: 1500 }, // default
  high:   { speechThreshold: 0.4, silenceWindowMs: 1000 }, // quiet rooms
} as const;
```

## Tuning procedure
1. Record a 10 s clip of the problematic environment.
2. Run `scripts/vad-debug.ts --file clip.wav --preset medium`.
3. Inspect the frame-by-frame probability plot (written to `tmp/vad.html`).
4. Adjust `speechThreshold` first, then `silenceWindowMs`.
5. Re-run until speech is captured with ≥ 200 ms padding on both sides.

## Edge cases
- **All silence**: emit `NO_SPEECH` event; do not call ASR.
- **Immediate speech** (user starts talking on press): pad 300 ms at start.
- **Cough / door slam**: require `minSpeechMs` consecutive speech frames.
- **Background music**: raise `speechThreshold`; consider a high-pass filter.

## Anti-patterns
- ❌ Hardcoding thresholds in the component. Use the preset object.
- ❌ Trimming silence *after* ASR — trim before, to save compute.
- ❌ Running VAD on the JS thread.
