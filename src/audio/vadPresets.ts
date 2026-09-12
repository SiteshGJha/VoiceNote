export type VadSensitivity = 'low' | 'medium' | 'high';

export interface VadConfig {
  frameMs: number;
  speechThreshold: number;
  silenceWindowMs: number;
  minSpeechMs: number;
  paddingMs: number;
}

export const VAD_PRESETS: Record<VadSensitivity, VadConfig> = {
  low: {
    frameMs: 30,
    speechThreshold: 0.6,
    silenceWindowMs: 2000,
    minSpeechMs: 300,
    paddingMs: 200,
  },
  medium: {
    frameMs: 30,
    speechThreshold: 0.5,
    silenceWindowMs: 1500,
    minSpeechMs: 300,
    paddingMs: 200,
  },
  high: {
    frameMs: 30,
    speechThreshold: 0.4,
    silenceWindowMs: 1000,
    minSpeechMs: 200,
    paddingMs: 200,
  },
};
