export type ModelKind = 'asr' | 'slm';

export interface ModelSpec {
  id: string;
  kind: ModelKind;
  displayName: string;
  sizeBytes: number;
  version: string;
  url: string;
  sha256: string;
  quant: string; // e.g. 'Q4_K_M', 'Q5_1'
  minRamGb: number;
  recommended?: boolean;
}

export interface InstalledModel {
  id: string;
  kind: ModelKind;
  displayName: string;
  sizeBytes: number;
  version: string;
  localPath: string;
  installedAt: string;
}

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'whisper-tiny-multilingual',
    kind: 'asr',
    displayName: 'Whisper Tiny (Multilingual)',
    sizeBytes: 78_000_000,
    version: '1.0.0',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    sha256: 'be07e048b1e59e0a541618b733902a3399cf3a04d64243dae29d0734604724e9',
    quant: 'int8',
    minRamGb: 1,
  },
  {
    id: 'whisper-base-multilingual',
    kind: 'asr',
    displayName: 'Whisper Base (Multilingual)',
    sizeBytes: 148_000_000,
    version: '1.0.0',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf00e087def5df46ac814ab383',
    quant: 'Q5_1',
    minRamGb: 2,
    recommended: true,
  },
  {
    id: 'whisper-small-multilingual',
    kind: 'asr',
    displayName: 'Whisper Small (Multilingual)',
    sizeBytes: 480_000_000,
    version: '1.0.0',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a73918e504fa01281966304498acc34f',
    quant: 'Q4_K_M',
    minRamGb: 4,
  },
  {
    id: 'qwen2.5-0.5b-instruct',
    kind: 'slm',
    displayName: 'Qwen 2.5 (0.5B Instruct)',
    sizeBytes: 350_000_000,
    version: '1.0.0',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    sha256: '2a6f5e3bc83bdf70221375d658c422f1837ff48ef2d42bf682974bfa6c27129f',
    quant: 'Q4_K_M',
    minRamGb: 2,
    recommended: true,
  },
  {
    id: 'palmer-005',
    kind: 'slm',
    displayName: 'Palmer-005 (0.5B Rewrite)',
    sizeBytes: 380_000_000,
    version: '0.5.0',
    url: 'https://huggingface.co/local-models/palmer-005-gguf/resolve/main/palmer-005-q4_k_m.gguf',
    sha256: '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
    quant: 'Q4_K_M',
    minRamGb: 2,
  },
];

export function getModelSpec(id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function getModelDestinationSubdir(kind: ModelKind): string {
  return kind; // 'asr' | 'slm'
}

export function getModelFileName(spec: ModelSpec): string {
  return `${spec.id}-${spec.quant}.gguf`;
}
