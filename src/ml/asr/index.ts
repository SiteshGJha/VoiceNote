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

    const isMock = uri.startsWith('/mock/');
    if (!isMock && !fs.existsSync(uri)) {
      return {
        status: 'error',
        code: 'AUDIO_RECORD_FAILED',
        message: `Audio file does not exist at URI: ${uri}`,
      };
    }

    // Estimate duration for short-clip language detection heuristic
    let audioDurationMs = 3000;
    if (!isMock && fs.existsSync(uri)) {
      try {
        const stats = fs.statSync(uri);
        audioDurationMs = Math.round(Math.max(0, stats.size - 44) / 32);
      } catch {
        audioDurationMs = 3000;
      }
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

    // 3. Language parameter handling & short clip heuristic (< 1.5s)
    let langParam: 'en' | 'hi' | undefined;
    let initialPrompt = opts.prompt;

    if (opts.lang === 'en') {
      langParam = 'en';
    } else if (opts.lang === 'hi') {
      langParam = 'hi';
    } else {
      // Auto: if short clip (< 1500 ms), Whisper language detection is unreliable
      if (audioDurationMs > 0 && audioDurationMs < 1500) {
        logger.info('ASR', `Short audio clip (${audioDurationMs}ms < 1500ms) in auto mode: defaulting language to 'en'`);
        langParam = 'en';
      } else {
        langParam = undefined;
      }
      initialPrompt = opts.prompt ?? 'The speaker may mix Hindi and English (Hinglish). Please transcribe both accurately.';
    }

    // 4. Run Whisper inference with timeout protection
    const modelPath = defaultModel.filePath ?? `/models/asr/${defaultModel.id}.gguf`;
    const inferenceResult = await runWhisperInference({
      audioUri: uri,
      modelPath,
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
