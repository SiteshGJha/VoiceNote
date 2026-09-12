# /bake-off-slm

Evaluate 2–3 candidate tone-rewriting models and pick a winner.

## Steps
1. Confirm the candidate list with the user (id + GGUF URL + quant).
2. For each candidate:
   a. Download via the model manager.
   b. Run `scripts/slm-bakeoff.ts --model <id>` against
      `fixtures/rewrite/{en,hi}.json`.
   c. Capture: tone fidelity (1–5), meaning-preservation pass rate,
      tokens/sec, peak RAM.
3. Build a comparison table.
4. Recommend the model with the best (fidelity × preservation) subject to
   tok/s ≥ 15 and RAM ≤ 500 MB.
5. Update `docs/MODELS.md` with the decision and the raw numbers.
6. Delete losing candidates from the device to reclaim storage.
