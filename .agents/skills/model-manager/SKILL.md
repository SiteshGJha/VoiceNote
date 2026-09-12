---
name: model-manager
description: >
  Handles downloading, verifying, installing, and deleting on-device ML
  models for VoiceNote. Use when adding a new model, changing the download
  flow, fixing checksum failures, or managing storage.
---

# Model Manager Skill

## When to use this skill
- Adding a new ASR or SLM model to the catalog.
- Changing the download source or format.
- Debugging failed / partial downloads.
- Adjusting storage limits or eviction rules.

## Architecture
```
[src/services/modelManager/]
├── catalog.ts        ← static list of available models
├── downloader.ts     ← HTTPS + resume + progress
├── verifier.ts       ← SHA-256 checksum
├── installer.ts      ← move to app support dir + register in MMKV
└── index.ts          ← public API
```

## Public API
```ts
type ModelKind = 'asr' | 'slm';

interface ModelSpec {
  id: string;
  kind: ModelKind;
  displayName: string;
  sizeBytes: number;
  version: string;
  url: string;
  sha256: string;
  quant: string;         // e.g. 'Q4_K_M', 'int8'
  minRamGb: number;
}

listInstalled(): InstalledModel[];
listAvailable(): ModelSpec[];
download(id: string, onProgress: (pct: number) => void): Promise<void>;
remove(id: string): Promise<void>;
verify(id: string): Promise<boolean>;
```

## Download flow
1. Check free storage ≥ `sizeBytes × 1.2`.
2. Create a `.part` file in the cache dir.
3. Stream download with `Range` header for resume.
4. On complete: compute SHA-256, compare to `spec.sha256`.
5. If mismatch → delete `.part`, return `MODEL_CHECKSUM_FAILED`.
6. If match → atomically rename into the models dir, register in MMKV.

## Storage layout
```
<app-support>/models/
├── asr/
│   └── whisper-base-multilingual-Q5_1.gguf
└── slm/
    └── qwen2.5-0.5b-instruct-Q4_K_M.gguf
```

## Rules
- Downloads only over HTTPS. Reject `http://`.
- Never download without explicit user action.
- Never overwrite an installed model without user confirmation.
- Always verify checksum before install.
- Deleting an in-use model → require confirmation, then unload first.

## Anti-patterns
- ❌ Bundling models in the app binary.
- ❌ Downloading in the background without a visible progress UI.
- ❌ Trusting file size alone as a validity check.
- ❌ Writing to the models dir before checksum passes.
