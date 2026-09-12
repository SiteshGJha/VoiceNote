import { audioRecorder } from '@/audio/recorder';
import { RecordedAudio } from '@/audio/types';
import { transcribe } from '@/ml/asr';
import { rewrite } from '@/ml/slm';
import { PipelineResult, DetectedLang } from '@/ml/types';
import { historyStorage } from '@/services/history';
import { PipelineExecutionOptions, PipelineStageCallback } from './types';
import { logger } from '@/utils/logger';

/**
 * End-to-end Pipeline Orchestrator.
 * Connects: Audio Capture -> VAD -> ASR -> STRICT AUDIO DELETE -> SLM Rewrite -> History Store.
 */
export async function executePipeline(
  audio: RecordedAudio,
  options: PipelineExecutionOptions,
  onStageChange?: PipelineStageCallback
): Promise<PipelineResult> {
  const pipelineStartTime = Date.now();
  logger.info('Pipeline', `Executing pipeline for ${audio.uri}, duration=${audio.durationMs}ms`);

  let rawTranscript = '';
  let detectedLanguage: DetectedLang = 'en';
  let asrDuration = 0;

  try {
    // 1. Stage: Speech-to-Text (ASR)
    onStageChange?.('asr');
    const asrResult = await transcribe(audio.uri, {
      lang: options.lang,
      hindiOutput: options.hindiOutput,
    });

    // 2. Prime Directive: Immediately delete temporary audio file post-ASR, regardless of result!
    await audioRecorder.cleanupTempFile(audio.uri);
    logger.info('Pipeline', 'Audio file cleanup completed immediately after ASR step');

    if (asrResult.status === 'error') {
      logger.warn('Pipeline', `ASR failed with code: ${asrResult.code}`);
      return {
        status: 'error',
        code: asrResult.code,
        message: asrResult.message,
      };
    }

    rawTranscript = asrResult.text;
    detectedLanguage = asrResult.detectedLang;
    asrDuration = asrResult.durationMs;

    // 3. Stage: Tone Rewriting (SLM)
    let finalRewrittenText = rawTranscript;
    if (!options.skipRewriting) {
      onStageChange?.('slm');
      const slmResult = await rewrite(rawTranscript, options.tone, {
        lang: detectedLanguage,
      });

      if (slmResult.status === 'ok') {
        finalRewrittenText = slmResult.final;
      } else {
        // Fall back gracefully to raw transcript on rewrite failure or suspected hallucination
        finalRewrittenText = slmResult.fallbackText;
        logger.warn('Pipeline', `SLM fallback activated: ${slmResult.message}`);
      }
    }

    const totalDurationMs = Date.now() - pipelineStartTime;

    // 4. Stage: Encrypted History Storage
    onStageChange?.('saving');
    await historyStorage.addRecord({
      rawText: rawTranscript,
      finalText: finalRewrittenText,
      tone: options.tone,
      lang: detectedLanguage,
      audioDurationMs: audio.durationMs,
      processingDurationMs: totalDurationMs,
    });

    onStageChange?.('done');
    logger.info('Pipeline', `Pipeline finished successfully in ${totalDurationMs}ms`);

    return {
      status: 'ok',
      raw: rawTranscript,
      final: finalRewrittenText,
      tone: options.tone,
      lang: detectedLanguage,
      totalDurationMs,
      audioDurationMs: audio.durationMs,
    };
  } catch (err) {
    // Always guarantee audio cleanup on unexpected pipeline error
    await audioRecorder.cleanupTempFile(audio.uri);
    logger.error('Pipeline', 'Unexpected exception in pipeline execution', err);

    return {
      status: 'error',
      code: 'ASR_TIMEOUT',
      message: err instanceof Error ? err.message : 'Pipeline execution failed',
      ...(rawTranscript ? { raw: rawTranscript } : {}),
    };
  }
}
