export interface IRustCoreHybridObject {
  getVersion(): string;
  trimAndSaveWav(pcm: ArrayBuffer, outputPath: string, paddingMs?: number): { hasSpeech: boolean; status: number };
}
