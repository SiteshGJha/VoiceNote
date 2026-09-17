import { MlErrorCode } from './errors';

export type Tone = 'professional' | 'casual';

export type Lang = 'auto' | 'en' | 'hi';

export type DetectedLang = 'en' | 'hi';

export type HindiOutputFormat = 'devanagari' | 'romanized';

export type AsrModelTier = 'fast' | 'balanced' | 'accurate';

export interface AsrOptions {
  lang: Lang;
  hindiOutput?: HindiOutputFormat | undefined;
  prompt?: string | undefined;
  timeoutMs?: number | undefined;
}

export type AsrResult =
  | {
      status: 'ok';
      text: string;
      detectedLang: DetectedLang;
      durationMs: number;
    }
  | {
      status: 'error';
      code: MlErrorCode;
      message: string;
    };

export interface SlmOptions {
  lang: DetectedLang;
  timeoutMs?: number | undefined;
  temperature?: number | undefined;
  modelPath?: string | undefined;
  modelId?: string | undefined;
}

export type SlmResult =
  | {
      status: 'ok';
      final: string;
      tone: Tone;
      durationMs: number;
      usedFallback: boolean;
    }
  | {
      status: 'error';
      code: MlErrorCode;
      message: string;
      fallbackText: string;
    };

export type PipelineResult =
  | {
      status: 'ok';
      raw: string;
      final: string;
      tone: Tone;
      lang: DetectedLang;
      totalDurationMs: number;
      audioDurationMs: number;
    }
  | {
      status: 'error';
      code: MlErrorCode;
      message: string;
      raw?: string;
    };
