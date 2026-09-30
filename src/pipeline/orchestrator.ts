import { audioRecorder } from '@/audio/recorder';
import { transcribe } from '@/ml/asr';
import { rewrite } from '@/ml/slm';
import { PipelineResult, DetectedLang } from '@/ml/types';
import { historyStorage } from '@/services/history';
import { AudioPipelineInput, PipelineExecutionOptions, PipelineStageCallback } from './types';
import { mergeSegments } from '@/audio/segmentMerger';
import { logger } from '@/utils/logger';

/**
 * End-to-end Pipeline Orchestrator.
 * Connects: Audio Capture -> VAD -> ASR -> STRICT AUDIO DELETE -> SLM Rewrite -> History Store.
 */
export async function executePipeline(
  audio: AudioPipelineInput,
  options: PipelineExecutionOptions,
  onStageChange?: PipelineStageCallback
): Promise<PipelineResult> {
  const pipelineStartTime = Date.now();
  const isChunked = 'segments' in audio;
  const totalAudioDuration = isChunked ? audio.totalDurationMs : audio.durationMs;
  const segmentList = isChunked ? audio.segments : [{ uri: audio.uri, durationMs: audio.durationMs, index: 0 }];

  logger.info('Pipeline', `Executing pipeline for ${isChunked ? `${segmentList.length} segments` : audio.uri}, duration=${totalAudioDuration}ms`);

  let rawTranscript = '';
  let detectedLanguage: DetectedLang = 'en';
  let asrDuration = 0;
  let slmDuration = 0;

  try {
    // 1. Stage: Speech-to-Text (ASR)
    onStageChange?.('asr');
    const asrStart = Date.now();
    const segmentTranscripts: string[] = [];

    for (const seg of segmentList) {
      const segResult = await transcribe(seg.uri, {
        lang: options.lang,
        hindiOutput: options.hindiOutput,
        asrTier: options.asrTier,
      });

      // Prime Directive: Immediately delete temporary audio file post-ASR, regardless of result!
      await audioRecorder.cleanupTempFile(seg.uri);

      if (segResult.status === 'error') {
        logger.warn('Pipeline', `ASR failed for segment ${seg.index} with code: ${segResult.code}`);
        return {
          status: 'error',
          code: segResult.code,
          message: segResult.message,
        };
      }

      segmentTranscripts.push(segResult.text);
      detectedLanguage = segResult.detectedLang;
    }

    asrDuration = Date.now() - asrStart;
    rawTranscript = mergeSegments(segmentTranscripts);

    // 3. Stage: Tone Rewriting (SLM)
    let finalRewrittenText = rawTranscript;
    let usedFallback = false;
    if (!options.skipRewriting) {
      onStageChange?.('slm');
      const slmStart = Date.now();
      const slmResult = await rewrite(rawTranscript, options.tone, {
        lang: detectedLanguage,
      });
      slmDuration = Date.now() - slmStart;

      if (slmResult.status === 'ok') {
        finalRewrittenText = slmResult.final;
      } else {
        // Fall back gracefully to raw transcript on rewrite failure or suspected hallucination
        finalRewrittenText = slmResult.fallbackText;
        usedFallback = true;
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
      audioDurationMs: totalAudioDuration,
      processingDurationMs: totalDurationMs,
      durationMs: totalAudioDuration,
      segmentCount: segmentList.length,
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
      audioDurationMs: totalAudioDuration,
      asrDurationMs: asrDuration,
      slmDurationMs: slmDuration,
      usedFallback,
    };
  } catch (err) {
    // Always guarantee audio cleanup on unexpected pipeline error
    for (const seg of segmentList) {
      await audioRecorder.cleanupTempFile(seg.uri);
    }
    logger.error('Pipeline', 'Unexpected exception in pipeline execution', err);

    return {
      status: 'error',
      code: 'ASR_TIMEOUT',
      message: err instanceof Error ? err.message : 'Pipeline execution failed',
      ...(rawTranscript ? { raw: rawTranscript } : {}),
    };
  }
}
