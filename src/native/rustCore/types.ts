export interface VadEvalResult {
  isSpeech: boolean;
  probability: number;
}

export interface AsrNativeResult {
  text: string;
  detectedLang: string;
  durationMs: number;
}

export interface IRustCoreHybridObject {
  getVersion(): string;
  trimAndSaveWav(pcm: ArrayBuffer, outputPath: string, paddingMs?: number): { hasSpeech: boolean; status: number };
  evalVad(pcm: ArrayBuffer, sensitivityMode?: number): VadEvalResult;
  transcribe(
    pcm: ArrayBuffer,
    modelPath: string,
    language?: string,
    prompt?: string,
    timeoutMs?: number
  ): AsrNativeResult;
}
