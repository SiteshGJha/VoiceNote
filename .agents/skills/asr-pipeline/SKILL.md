---
name: asr-pipeline
description: >
  Implements, modifies, or debugs the offline speech-to-text pipeline for
  VoiceNote. Use when the task involves Whisper model loading, transcription,
  language detection (English/Hindi/Hinglish), audio buffer handling, or
  ASR error handling.
---

# ASR Pipeline Skill

## When to use this skill
- Adding or swapping an ASR model (Whisper Tiny/Base/Small, Qwen3-ASR).
- Fixing transcription accuracy for English, Hindi, or code-switched audio.
- Changing how audio buffers are fed to the ASR engine.
- Wiring ASR results into the tone-rewriting stage.

## Architecture
```
[audio file / PCM buffer]
        │
        ▼
[src/ml/asr/index.ts]  ← public API: transcribe(uri, { lang }) → AsrResult
        │
        ├── loads model from src/ml/asr/modelRegistry.ts
        ├── resamples to 16 kHz mono if needed
        ├── calls native binding (whisper.rn | sherpa-onnx)
        └── returns { text, lang, confidence, durationMs }
```

## Public API contract
```ts
type Lang = 'auto' | 'en' | 'hi';
type AsrResult =
  | { status: 'ok'; text: string; detectedLang: 'en' | 'hi'; durationMs: number }
  | { status: 'error'; code: AsrErrorCode; message: string };

export async function transcribe(uri: string, opts: { lang: Lang }): Promise<AsrResult>;
```

## Model loading checklist
1. Check `modelRegistry` for an installed model matching the requested tier.
2. If missing → return `ASR_MODEL_MISSING` (do not auto-download here).
3. Load on a worker thread. Log load time to the perf buffer.
4. Cache the loaded model for the session; unload after 5 min idle.

## Language handling
- `auto`: pass `language: undefined` to Whisper; trust its detector.
- `en` / `hi`: pass the ISO code explicitly. Do **not** rely on detection.
- Hinglish: pass `initial_prompt` with a short bilingual hint, e.g.
  `"The speaker may mix Hindi and English."`

## Hindi output
- Default: Devanagari.
- If setting `hindiOutput === 'romanized'`, post-process with
  `src/ml/asr/romanize.ts` (transliteration table, not a model).

## Error handling
| Code | User-facing behavior |
|---|---|
| `ASR_EMPTY_OUTPUT` | "Didn't catch that — try again" |
| `ASR_TIMEOUT` | "Transcription took too long" + retry |
| `ASR_MODEL_MISSING` | Prompt to download model |
| Native crash | Catch at JSI boundary; return error, never throw to JS |

## Anti-patterns
- ❌ Loading the model on the JS thread.
- ❌ Passing a file URI directly to the native layer without checking existence.
- ❌ Calling `transcribe` before VAD has trimmed silence.
- ❌ Assuming Whisper's language detection is correct for short clips
  (< 1.5 s) — default to the user's setting instead.

## Testing
- Unit: feed a known 3 s WAV → assert exact transcript for EN and HI fixtures.
- Integration: full pipeline from `RecordedAudio` → `AsrResult`.
- Accuracy: run `scripts/wer.ts` against `fixtures/en/` and `fixtures/hi/`.
