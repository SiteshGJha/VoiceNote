export interface VadEvalResult {
  isSpeech: boolean;
  probability: number;
}

export interface AsrNativeResult {
  text: string;
  detectedLang: string;
  durationMs: number;
}

export interface SlmNativeResult {
  text: string;
  durationMs: number;
}

export interface IRustCoreHybridObject {
  getVersion(): string;
  trimAndSaveWav(pcm: ArrayBuffer, outputPath: string, paddingMs?: number): { hasSpeech: boolean; status: number };
  evalVad(pcm: ArrayBuffer, sensitivityMode?: number): VadEvalResult;
  resetVad(): void;
  transcribe(
    pcm: ArrayBuffer,
    modelPath: string,
    language?: string,
    prompt?: string,
    timeoutMs?: number
  ): Promise<AsrNativeResult>;
  generate(
    prompt: string,
    modelPath: string,
    temperature?: number,
    topP?: number,
    maxTokens?: number,
    timeoutMs?: number
  ): Promise<SlmNativeResult>;
  verifyFileSha256(filePath: string, expectedHex: string): boolean;
}
