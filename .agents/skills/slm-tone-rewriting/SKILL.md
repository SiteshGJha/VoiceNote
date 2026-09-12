---
name: slm-tone-rewriting
description: >
  Implements or tunes the on-device small language model that rewrites raw
  transcripts into Professional or Casual tone. Use when editing prompts,
  changing the tone model, fixing hallucination, or preserving meaning.
---

# SLM Tone Rewriting Skill

## When to use this skill
- Changing the rewriting model (Palmer-005, Qwen2.5-0.5B, Gemma-2-2B).
- Editing or adding tone prompts.
- Fixing tone leakage (casual text in professional mode, or vice versa).
- Preventing the model from adding facts or dropping entities.
- Tuning generation parameters (temperature, max tokens, stop sequences).

## Architecture
```
[raw transcript] + [tone] + [lang]
        │
        ▼
[src/ml/slm/promptBuilder.ts] → chat-formatted prompt
        │
        ▼
[llama.rn] → streaming tokens
        │
        ▼
[src/ml/slm/postProcess.ts] → strip preamble, trim, validate
        │
        ▼
[final text]
```

## Prompt contract
Every prompt is built from a template with these slots:
- `{TONE}` — "professional" | "casual"
- `{LANG}` — "English" | "Hindi"
- `{RAW}` — the raw transcript
- `{RULES}` — tone-specific constraints

## Canonical prompts

### Professional
```
You rewrite spoken text into clear, professional writing.
Rules:
- Remove filler words (um, uh, like, you know, matlab, arre).
- Use complete sentences. No contractions.
- Preserve every fact, name, number, and date exactly.
- Do not add information that is not in the input.
- Output only the rewritten text. No preamble, no quotes.
- Language: {LANG}.

Input: {RAW}
Output:
```

### Casual
```
You rewrite spoken text into natural, casual writing.
Rules:
- Keep contractions and everyday phrasing.
- Light cleanup only — do not formalize.
- Preserve every fact, name, number, and date exactly.
- Output only the rewritten text. No preamble, no quotes.
- Language: {LANG}.

Input: {RAW}
Output:
```

## Generation parameters
```ts
export const SLM_PARAMS = {
  temperature: 0.3,      // low — we want faithful rewriting, not creativity
  topP: 0.9,
  maxTokens: 512,
  stop: ['\n\n', 'Input:', 'Output:'],
  repeatPenalty: 1.1,
} as const;
```

## Meaning-preservation guard
After generation, run `validatePreservation(raw, final)`:
1. Extract all numbers, dates, proper nouns from `raw` (regex + simple NER).
2. Assert each appears in `final`. If any is missing → flag
   `SLM_HALLUCINATION_SUSPECTED` and fall back to `raw`.
3. Assert `final` length is within 0.5×–2× of `raw`.

## Anti-patterns
- ❌ Temperature > 0.5 for tone rewriting — causes drift.
- ❌ Letting the model output markdown headings unless asked.
- ❌ Skipping the preservation guard "because it looked fine".
- ❌ Re-using the ASR thread for SLM inference (separate worker).
- ❌ Running both models simultaneously if device RAM < 6 GB.

## Bake-off procedure
When evaluating a new tone model:
1. Prepare `fixtures/rewrite/en.json` and `fixtures/rewrite/hi.json`
   — 30 raw transcripts each, with hand-written reference outputs.
2. Run `scripts/slm-bakeoff.ts --models A,B,C`.
3. Score on: tone fidelity (1–5), meaning preservation (pass/fail),
   tokens/sec, peak RAM.
4. Record results in `docs/MODELS.md`.
