import * as fs from 'fs';
import { AsrOptions, AsrResult, DetectedLang } from '../types';
import { MlError } from '../errors';
import { asrModelRegistry } from './modelRegistry';
import { romanizeHindi } from './romanize';
import { runWhisperInference } from './whisperRunner';
import { logger } from '@/utils/logger';

/**
 * Public ASR Transcription API.
 * 1. Checks model registry. If missing -> ASR_MODEL_MISSING.
 * 2. Prepares language arguments (ISO code or auto-detect).
 * 3. Enforces 30 s timeout.
 * 4. Post-processes Hindi Romanization if requested.
 * 5. Returns AsrResult (never throws unhandled exceptions).
 */
export async function transcribe(uri: string, opts: AsrOptions): Promise<AsrResult> {
  const startTime = Date.now();
  logger.info('ASR', `Starting transcription for ${uri} (lang: ${opts.lang})`);

  try {
    // 1. Verify file exists
    if (!uri) {
      return {
        status: 'error',
        code: 'AUDIO_RECORD_FAILED',
        message: 'Audio file URI is empty or invalid.',
      };
    }

    // 2. Check model registry
    const defaultModel = asrModelRegistry.getModelForTier('balanced');
    if (!defaultModel?.isInstalled) {
      logger.warn('ASR', 'ASR model is missing');
      return {
        status: 'error',
        code: 'ASR_MODEL_MISSING',
        message: 'ASR model is not installed. Please download it first.',
      };
    }

    // 3. Language parameter handling
    let langParam: 'en' | 'hi' | undefined;
    let initialPrompt = opts.prompt;

    if (opts.lang === 'en') {
      langParam = 'en';
    } else if (opts.lang === 'hi') {
      langParam = 'hi';
    } else {
      // Auto: Hinglish hint if user mixes languages
      langParam = undefined;
      initialPrompt = 'The speaker may mix Hindi and English.';
    }

    // 4. Run Whisper inference with timeout protection
    const inferenceResult = await runWhisperInference({
      audioUri: uri,
      language: langParam,
      initialPrompt,
      timeoutMs: opts.timeoutMs ?? 30_000,
    });

    let finalText = inferenceResult.text.trim();

    // 5. Validate non-empty output
    if (!finalText) {
      return {
        status: 'error',
        code: 'ASR_EMPTY_OUTPUT',
        message: "Didn't catch that — try again",
      };
    }

    // 6. Post-process Hindi romanization if configured
    if (inferenceResult.detectedLang === 'hi' && opts.hindiOutput === 'romanized') {
      finalText = romanizeHindi(finalText);
      logger.info('ASR', 'Applied Hindi romanization post-processing');
    }

    const durationMs = Date.now() - startTime;
    logger.info('ASR', `Transcription completed in ${durationMs}ms: "${finalText}"`);

    return {
      status: 'ok',
      text: finalText,
      detectedLang: inferenceResult.detectedLang,
      durationMs,
    };
  } catch (err) {
    logger.error('ASR', 'Transcription failed with error', err);
    if (err instanceof MlError) {
      return {
        status: 'error',
        code: err.code,
        message: err.message,
      };
    }
    return {
      status: 'error',
      code: 'ASR_TIMEOUT',
      message: err instanceof Error ? err.message : 'Transcription failed',
    };
  }
}
