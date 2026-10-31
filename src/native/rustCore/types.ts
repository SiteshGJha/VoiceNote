export interface VadEvalResult {
  isSpeech: boolean;
  probability: number;
}

export interface IRustCoreHybridObject {
  getVersion(): string;
  trimAndSaveWav(pcm: ArrayBuffer, outputPath: string, paddingMs?: number): { hasSpeech: boolean; status: number };
  evalVad(pcm: ArrayBuffer, sensitivityMode?: number): VadEvalResult;
}
