import { Tone, Lang, HindiOutputFormat } from '@/ml/types';

export interface PipelineExecutionOptions {
  tone: Tone;
  lang: Lang;
  hindiOutput?: HindiOutputFormat;
  skipRewriting?: boolean;
}

export type PipelineStageCallback = (stage: 'vad' | 'asr' | 'slm' | 'saving' | 'done') => void;
