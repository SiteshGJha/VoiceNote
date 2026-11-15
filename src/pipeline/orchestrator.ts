import { AppState } from 'react-native';
import { audioRecorder } from '@/audio/recorder';
import { transcribe } from '@/ml/asr';
import { rewrite } from '@/ml/slm';
import { PipelineResult, DetectedLang } from '@/ml/types';
import { historyStorage } from '@/services/history';
import {
  AudioPipelineInput,
  PipelineExecutionOptions,
  PipelineStageCallback,
  RollingSessionController,
  RollingProgressCallback,
  SegmentedAudioItem,
} from './types';
import { mergeSegments } from '@/audio/segmentMerger';
import { whisperNative } from '@/native/whisperNative';
import Clipboard from '@react-native-clipboard/clipboard';
import { logger } from '@/utils/logger';

/**
 * Live Rolling Pipeline Session Manager.
 * Orchestrates background FIFO Whisper worker, trailing 40-character prompt conditioning,
 * post-ASR audio unlinking, and sequential memory unmapping before SLM allocation.
 */
export function startRollingPipelineSession(
  options: PipelineExecutionOptions,
  onProgress?: RollingProgressCallback
): RollingSessionController {
  const sessionStartTime = Date.now();
  const queue: SegmentedAudioItem[] = [];
  const completedSegments: { index: number; text: string; durationMs: number }[] = [];
  let trailingPromptText = '';
  let detectedLanguage: DetectedLang = 'en';
  let totalAudioDurationMs = 0;
  let totalAsrDurationMs = 0;
  let inFlight = false;
  let isCancelled = false;
  let isFinalized = false;
  let finalizeResolver: ((res: PipelineResult) => void) | null = null;

  const processNext = async (): Promise<void> => {
    if (inFlight || isCancelled) {
      return;
    }

    if (queue.length === 0) {
      if (isFinalized && finalizeResolver) {
        await executeFinalization();
      }
      return;
    }

    inFlight = true;
    const chunk = queue.shift()!;
    totalAudioDurationMs += chunk.durationMs;

    try {
      const initialPrompt = trailingPromptText.length > 0 ? trailingPromptText.slice(-40) : undefined;
      const asrStart = Date.now();

      const res = await transcribe(chunk.uri, {
        lang: options.lang,
        hindiOutput: options.hindiOutput,
        asrTier: options.asrTier,
        initialPrompt,
      });

      totalAsrDurationMs += Math.max(1, Date.now() - asrStart);

      if (res.status === 'ok') {
        const text = res.text.trim();
        if (text.length > 0) {
          completedSegments.push({
            index: chunk.index,
            text,
            durationMs: chunk.durationMs,
          });
          trailingPromptText = (trailingPromptText + ' ' + text).trim();
          detectedLanguage = res.detectedLang;
        } else {
          logger.info('Pipeline', `Chunk ${chunk.index} transcribed to empty text (silence/pause), omitting cleanly.`);
        }
      } else {
        if (res.code === 'ASR_EMPTY_OUTPUT') {
          logger.info('Pipeline', `Chunk ${chunk.index} was silence (ASR_EMPTY_OUTPUT), omitting cleanly.`);
        } else {
          logger.warn('Pipeline', `Chunk ${chunk.index} ASR failed: ${res.code}. Inserting localized placeholder.`);
          completedSegments.push({
            index: chunk.index,
            text: `[untranscribed audio: ${Math.round(chunk.durationMs / 1000)}s]`,
            durationMs: chunk.durationMs,
          });
        }
      }
    } catch (err) {
      logger.warn('Pipeline', `Chunk ${chunk.index} threw unexpected error`, err);
      completedSegments.push({
        index: chunk.index,
        text: `[untranscribed audio: ${Math.round(chunk.durationMs / 1000)}s]`,
        durationMs: chunk.durationMs,
      });
    } finally {
      // PRIME DIRECTIVE: audio chunk strictly deleted immediately post-ASR!
      await audioRecorder.cleanupTempFile(chunk.uri);
      inFlight = false;
    }

    onProgress?.({
      completedChunks: completedSegments.length,
      partialTranscript: trailingPromptText,
      stage: 'recording',
    });

    processNext();
  };

  const executeFinalization = async (): Promise<void> => {
    try {
      completedSegments.sort((a, b) => a.index - b.index);
      const segmentTexts = completedSegments.map((s) => s.text);
      const rawTranscript = mergeSegments(segmentTexts);

      // Sequential RAM Invariant (< 500 MB budget):
      // Explicitly unload Whisper ASR model context from memory before SLM allocation
      try {
        await whisperNative.unloadModel();
      } catch (unloadErr) {
        logger.warn('Pipeline', 'Failed to unload Whisper model post-ASR', unloadErr);
      }

      // Mandatory 200ms deallocation cooldown to allow Metal/Vulkan GPU unmapping
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (completedSegments.length === 0 || rawTranscript.trim().length === 0) {
        logger.info('Pipeline', 'Rolling session produced 0 speech segments. Completing with ASR_EMPTY_OUTPUT.');
        finalizeResolver?.({
          status: 'error',
          code: 'ASR_EMPTY_OUTPUT',
          message: "Didn't catch that — try again",
        });
        return;
      }

      let finalRewrittenText = rawTranscript;
      let usedFallback = false;
      let slmDuration = 0;

      if (!options.skipRewriting && rawTranscript.trim().length > 0) {
        onProgress?.({
          completedChunks: completedSegments.length,
          partialTranscript: rawTranscript,
          stage: 'rewriting',
        });

        const slmStart = Date.now();
        const slmResult = await rewrite(rawTranscript, options.tone, {
          lang: detectedLanguage,
        });
        slmDuration = Math.max(1, Date.now() - slmStart);

        if (slmResult.status === 'ok') {
          finalRewrittenText = slmResult.final;
        } else {
          finalRewrittenText = slmResult.fallbackText;
          usedFallback = true;
          logger.warn('Pipeline', `SLM fallback activated in rolling session: ${slmResult.message}`);
        }
      }

      // Guarded clipboard copy
      if (options.autoCopy !== false && finalRewrittenText) {
        try {
          const isAppActive = typeof AppState !== 'undefined' ? AppState.currentState === 'active' : true;
          if (isAppActive) {
            Clipboard.setString(finalRewrittenText);
            logger.info('Pipeline', 'Final rewritten text auto-copied to system clipboard');
          }
        } catch (clipErr) {
          logger.warn('Pipeline', 'Failed to auto-copy text to system clipboard', clipErr);
        }
      }

      const totalDurationMs = Date.now() - sessionStartTime;

      if (rawTranscript.trim().length > 0) {
        await historyStorage.addRecord({
          rawText: rawTranscript,
          finalText: finalRewrittenText,
          tone: options.tone,
          lang: detectedLanguage,
          audioDurationMs: totalAudioDurationMs,
          processingDurationMs: totalDurationMs,
          durationMs: totalAudioDurationMs,
          segmentCount: completedSegments.length,
        });
      }

      finalizeResolver?.({
        status: 'ok',
        raw: rawTranscript,
        final: finalRewrittenText,
        tone: options.tone,
        lang: detectedLanguage,
        totalDurationMs,
        audioDurationMs: totalAudioDurationMs,
        asrDurationMs: totalAsrDurationMs,
        slmDurationMs: slmDuration,
        usedFallback,
      });
    } catch (err) {
      logger.error('Pipeline', 'Failed during rolling session finalization', err);
      finalizeResolver?.({
        status: 'error',
        code: 'ASR_TIMEOUT',
        message: err instanceof Error ? err.message : 'Rolling session finalization failed',
      });
    }
  };

  return {
    pushChunk(chunk: SegmentedAudioItem): void {
      if (isCancelled) {
        audioRecorder.cleanupTempFile(chunk.uri);
        return;
      }
      queue.push(chunk);
      processNext();
    },

    finalizeSession(): Promise<PipelineResult> {
      if (isFinalized) {
        throw new Error('Session is already finalized');
      }
      isFinalized = true;
      return new Promise<PipelineResult>((resolve) => {
        finalizeResolver = resolve;
        if (!inFlight && queue.length === 0) {
          executeFinalization();
        }
      });
    },

    async cancelSession(): Promise<void> {
      isCancelled = true;
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          await audioRecorder.cleanupTempFile(item.uri);
        }
      }
      try {
        await whisperNative.unloadModel();
      } catch (unloadErr) {
        logger.warn('Pipeline', 'Failed to unload Whisper model on cancel', unloadErr);
      }
    },
  };
}

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

    asrDuration = Math.max(1, Date.now() - asrStart);
    rawTranscript = mergeSegments(segmentTranscripts);

    // Sequential RAM Invariant (< 500 MB budget):
    // Explicitly unload Whisper ASR model context from memory before SLM allocation
    try {
      await whisperNative.unloadModel();
    } catch (unloadErr) {
      logger.warn('Pipeline', 'Failed to unload Whisper model post-ASR', unloadErr);
    }

    // 3. Stage: Tone Rewriting (SLM)
    let finalRewrittenText = rawTranscript;
    let usedFallback = false;
    if (!options.skipRewriting) {
      onStageChange?.('slm');
      const slmStart = Date.now();
      const slmResult = await rewrite(rawTranscript, options.tone, {
        lang: detectedLanguage,
      });
      slmDuration = Math.max(1, Date.now() - slmStart);

      if (slmResult.status === 'ok') {
        finalRewrittenText = slmResult.final;
      } else {
        // Fall back gracefully to raw transcript on rewrite failure or suspected hallucination
        finalRewrittenText = slmResult.fallbackText;
        usedFallback = true;
        logger.warn('Pipeline', `SLM fallback activated: ${slmResult.message}`);
      }
    }

    // Auto-copy final rewritten text (or fallback) to system clipboard
    if (options.autoCopy !== false && finalRewrittenText) {
      try {
        const isAppActive = typeof AppState !== 'undefined' ? AppState.currentState === 'active' : true;
        if (isAppActive) {
          Clipboard.setString(finalRewrittenText);
          logger.info('Pipeline', 'Final rewritten text auto-copied to system clipboard');
        }
      } catch (clipErr) {
        logger.warn('Pipeline', 'Failed to auto-copy text to system clipboard', clipErr);
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
