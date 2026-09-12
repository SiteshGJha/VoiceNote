import { Tone, SlmOptions, SlmResult } from '../types';
import { MlError } from '../errors';
import { buildPrompt } from './promptBuilder';
import { runLlamaInference } from './llamaRunner';
import { postProcessOutput } from './postProcess';
import { validatePreservation } from './validator';
import { logger } from '@/utils/logger';

/**
 * Public Tone Rewriting API.
 * Rewrites raw transcript into the chosen tone with strict entity preservation guards.
 * On failure or suspected hallucination, gracefully falls back to the raw transcript.
 */
export async function rewrite(rawText: string, tone: Tone, opts: SlmOptions): Promise<SlmResult> {
  const startTime = Date.now();
  const trimmedRaw = rawText.trim();

  if (!trimmedRaw) {
    return {
      status: 'error',
      code: 'ASR_EMPTY_OUTPUT',
      message: 'Cannot rewrite empty text.',
      fallbackText: '',
    };
  }

  logger.info('SLM', `Rewriting text (${trimmedRaw.length} chars) to tone=${tone}, lang=${opts.lang}`);

  try {
    const prompt = buildPrompt(trimmedRaw, tone, opts.lang);
    const rawGenerated = await runLlamaInference({
      prompt,
      timeoutMs: opts.timeoutMs ?? 10_000,
      temperature: opts.temperature ?? 0.3,
    });

    const cleanedText = postProcessOutput(rawGenerated);

    // Run meaning preservation guard
    const validation = validatePreservation(trimmedRaw, cleanedText);
    if (!validation.isValid) {
      logger.warn('SLM', `Validation failed: ${validation.reason}. Falling back to raw transcript.`);
      return {
        status: 'error',
        code: 'SLM_HALLUCINATION_SUSPECTED',
        message: validation.reason ?? 'Suspected entity loss or length drift',
        fallbackText: trimmedRaw,
      };
    }

    const durationMs = Date.now() - startTime;
    logger.info('SLM', `Rewriting completed in ${durationMs}ms`);

    return {
      status: 'ok',
      final: cleanedText,
      tone,
      durationMs,
      usedFallback: false,
    };
  } catch (err) {
    logger.error('SLM', 'SLM rewrite encountered error', err);
    const code = err instanceof MlError ? err.code : 'SLM_TIMEOUT';
    const message = err instanceof Error ? err.message : 'Rewriting failed';

    return {
      status: 'error',
      code,
      message,
      fallbackText: trimmedRaw,
    };
  }
}
