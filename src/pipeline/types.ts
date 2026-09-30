import { Tone, Lang, HindiOutputFormat, AsrModelTier } from '@/ml/types';
import { RecordedAudio } from '@/audio/types';

export interface SegmentedAudioItem {
  uri: string;
  durationMs: number;
  index: number;
}

export interface SegmentedAudioInput {
  segments: SegmentedAudioItem[];
  totalDurationMs: number;
}

export type AudioPipelineInput = RecordedAudio | SegmentedAudioInput;

export interface PipelineExecutionOptions {
  tone: Tone;
  lang: Lang;
  hindiOutput?: HindiOutputFormat;
  skipRewriting?: boolean;
  asrTier?: AsrModelTier;
}

export type PipelineStageCallback = (stage: 'vad' | 'asr' | 'slm' | 'saving' | 'done') => void;
