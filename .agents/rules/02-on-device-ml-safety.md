---
trigger: always_on
---

# On-Device ML Safety

## Model loading
- Models load lazily — never at app startup.
- Every model load is wrapped in `try/catch`. On failure, degrade gracefully:
  ASR failure → show "Couldn't transcribe" + retry.
  SLM failure → show raw transcript + warning banner.
- Never block the UI thread while a model loads.

## Inference
- All inference calls have a **timeout**:
  - ASR: 30 s
  - SLM: 10 s
- On timeout: abort, free resources, surface the error to the UI.
- Peak memory budget: **< 500 MB**. If a model exceeds this on a target
  device, it is the wrong model — pick a smaller quant.

## Quantization
- Default to **Q4_K_M** GGUF for SLMs.
- Default to the smallest Whisper quant that meets the WER target.
- Document the exact quant in `docs/MODELS.md` when you change it.

## Resource cleanup
- Free the audio buffer after ASR completes.
- Unload the SLM after 60 s of inactivity (configurable).
- Never hold two large models in memory simultaneously unless the device
  has > 6 GB RAM.

## Error taxonomy
Use these codes consistently in `src/ml/errors.ts`:
- `ASR_EMPTY_OUTPUT` — model returned empty string
- `ASR_TIMEOUT`
- `ASR_MODEL_MISSING`
- `SLM_TIMEOUT`
- `SLM_HALLUCINATION_SUSPECTED`
- `MODEL_CHECKSUM_FAILED`
- `STORAGE_FULL`
