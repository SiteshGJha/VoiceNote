# /add-asr-model

Add a new ASR model to VoiceNote's catalog and verify it end-to-end.

## Steps
1. Ask the user for: model id, display name, source URL, SHA-256, quant,
   approximate size, and minimum RAM.
2. Add the entry to `src/services/modelManager/catalog.ts`.
3. Add a fixture transcript pair under `fixtures/asr/<id>/` (one EN, one HI).
4. Run `/skill asr-pipeline` to confirm the public API contract is unchanged.
5. Run `scripts/wer.ts --model <id> --fixtures fixtures/asr/<id>`.
6. Report WER for EN and HI, plus peak RAM and RTF.
7. If WER improves and RAM is within budget, mark the model as `recommended`
   in the catalog and update `docs/MODELS.md`.
