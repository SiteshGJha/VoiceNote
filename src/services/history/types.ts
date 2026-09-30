import { Tone, DetectedLang } from '@/ml/types';

export interface TranscriptionRecord {
  id: string;
  timestamp: string; // ISO 8601
  rawText: string;
  finalText: string;
  tone: Tone;
  lang: DetectedLang;
  audioDurationMs: number;
  processingDurationMs: number;
  _v?: number | undefined;
  wordCount?: number | undefined;
  durationMs?: number | undefined;
  segmentCount?: number | undefined;
}

export type HistoryRecordInput = Omit<TranscriptionRecord, 'id' | 'timestamp'> & {
  wordCount?: number | undefined;
  durationMs?: number | undefined;
  segmentCount?: number | undefined;
  _v?: number | undefined;
};
