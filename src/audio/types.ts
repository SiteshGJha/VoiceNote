export type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

export interface AudioFormatConfig {
  sampleRate: 16000;
  channels: 1;
  bitsPerSample: 16;
}

export const DEFAULT_AUDIO_CONFIG: AudioFormatConfig = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
};

export interface RecordedAudio {
  uri: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  byteLength: number;
  hasSpeech?: boolean;
}

export interface AudioMeteringData {
  amplitude: number; // Normalized 0.0 to 1.0
  rawRms: number;
  peak: number;
}
