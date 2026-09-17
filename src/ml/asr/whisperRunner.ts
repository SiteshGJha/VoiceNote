import { whisperNative } from '@/native/whisperNative';
import { DetectedLang } from '../types';

export interface WhisperInferenceParams {
  audioUri: string;
  modelPath: string;
  language?: 'en' | 'hi' | undefined;
  initialPrompt?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Off-main-thread Whisper runner.
 * Delegates to native Whisper bridge with 30s timeout protection and session caching.
 */
export async function runWhisperInference(
  params: WhisperInferenceParams
): Promise<{ text: string; detectedLang: DetectedLang }> {
  const result = await whisperNative.transcribe({
    audioUri: params.audioUri,
    modelPath: params.modelPath,
    language: params.language,
    initialPrompt: params.initialPrompt,
    timeoutMs: params.timeoutMs,
  });

  return {
    text: result.text,
    detectedLang: result.detectedLang,
  };
}
