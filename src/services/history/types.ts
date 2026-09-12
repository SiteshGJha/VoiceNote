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
}

export type HistoryRecordInput = Omit<TranscriptionRecord, 'id' | 'timestamp'>;
