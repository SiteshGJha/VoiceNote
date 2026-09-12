---
trigger: always_on
---

# VoiceNote — Project Context

You are working on **VoiceNote**, a fully offline, privacy-first mobile app
that converts speech to text and rewrites it into a chosen tone.

## Product
- Platforms: iOS 16+, Android 10+ (React Native, bare workflow)
- Languages: English (en), Hindi (hi), Hinglish (code-switched)
- Core pipeline: Audio → VAD → ASR (Whisper) → Tone SLM → UI
- Tones: `professional` (default) and `casual`
- Zero network calls during core operation. Only model downloads may use the network.

## Non-negotiable constraints
1. **No cloud inference.** Ever. If you are tempted to suggest an API call for
   ASR or rewriting, stop and propose an on-device alternative.
2. **No telemetry or analytics SDKs.**
3. **Audio is never persisted.** Delete the temp file immediately after ASR.
4. **All ML inference runs off the JS main thread** (native thread or isolate).
5. **Models are not bundled in the binary.** They are downloaded on first run.

## Reference documents
- `@docs/PRD.md` — full product requirements
- `@docs/TASKS.md` — ordered task breakdown
- `@docs/MODELS.md` — model candidates and bake-off results

## When in doubt
Prefer the smallest, fastest, most private solution that satisfies the PRD.
If a change touches ML inference, privacy, or storage, state your reasoning
explicitly before editing.
