import { Tone, Lang, HindiOutputFormat, AsrModelTier, PipelineResult } from '@/ml/types';
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

export interface ChunkReadyEvent {
  sessionId: string;
  chunk: SegmentedAudioItem;
}

export interface RollingSessionProgress {
  completedChunks: number;
  partialTranscript: string;
  stage: 'recording' | 'transcribing' | 'rewriting';
}

export interface RollingSessionController {
  pushChunk(chunk: SegmentedAudioItem): void;
  finalizeSession(): Promise<PipelineResult>;
  cancelSession(): Promise<void>;
}

export type AudioPipelineInput = RecordedAudio | SegmentedAudioInput;

export interface PipelineExecutionOptions {
  tone: Tone;
  lang: Lang;
  hindiOutput?: HindiOutputFormat;
  skipRewriting?: boolean;
  asrTier?: AsrModelTier;
  autoCopy?: boolean;
}

export type PipelineStageCallback = (stage: 'vad' | 'asr' | 'slm' | 'saving' | 'done') => void;
export type RollingProgressCallback = (progress: RollingSessionProgress) => void;

