import * as fs from 'fs';
import { AsrOptions, AsrResult, AsrModelTier, DetectedLang } from '../types';
import { MlError } from '../errors';
import { asrModelRegistry } from './modelRegistry';
import { romanizeHindi } from './romanize';
import { runWhisperInference } from './whisperRunner';
import { computeLanguageStrategy, dominantDetectedLang, hasDevanagari } from './language';
import { normalizeTranscript, isEmptyTranscript } from './normalize';
import { extractPcmFromWav, computeSegmentBoundaries, writeSegmentWav, AudioSegment } from './segmenter';
import { mergeSegments } from '@/audio/segmentMerger';
import { logger } from '@/utils/logger';

/**
 * Public ASR Transcription API.
 * 1. Resolves the model by the user's tier (fast/balanced/accurate).
 * 2. Verifies the model file actually exists on disk (production guard).
 * 3. Builds a bilingual (Hinglish) prompt strategy with a short-clip heuristic.
 * 4. Segments long recordings (>27s) at silence boundaries and transcribes
 *    each slice, so no trailing audio or code-switched content is dropped.
 * 5. Enforces a duration-adaptive timeout instead of a rigid 30s cap.
 * 6. Normalizes + post-processes (Hindi romanization) the merged transcript.
 * 7. Returns AsrResult (never throws unhandled exceptions).
 */

const DEFAULT_ASR_TIMEOUT_MS = 30_000;
const MAX_ASR_TIMEOUT_MS = 120_000;
const MIN_SEGMENT_DURATION_MS = 27_000;
const BYTES_PER_MS = 32; // 16 kHz * 2 bytes/sample

function estimateDurationFromBytes(sizeBytes: number): number {
  return Math.round(Math.max(0, sizeBytes - 44) / BYTES_PER_MS);
}

/**
 * Scales the inference timeout with audio duration so larger models on slower
 * devices are not killed before finishing, while still bounding worst-cases.
 */
export function computeTimeoutForDuration(audioDurationMs: number, requested?: number): number {
  if (requested && requested > 0) {
    return requested;
  }
  const scaled = Math.round(audioDurationMs * 3) + 15_000;
  return Math.min(MAX_ASR_TIMEOUT_MS, Math.max(DEFAULT_ASR_TIMEOUT_MS, scaled));
}

export async function transcribe(uri: string, opts: AsrOptions): Promise<AsrResult> {
  const startTime = Date.now();
  logger.info('ASR', `Starting transcription for ${uri} (lang: ${opts.lang}, tier: ${opts.asrTier ?? 'balanced'})`);

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

    // 2. Resolve model by the user's selected tier (not hardcoded 'balanced')
    const tier: AsrModelTier = opts.asrTier ?? 'balanced';
    const defaultModel = asrModelRegistry.getModelForTier(tier);
    if (!defaultModel?.isInstalled) {
      logger.warn('ASR', `ASR model missing for tier ${tier}`);
      return {
        status: 'error',
        code: 'ASR_MODEL_MISSING',
        message: 'ASR model is not installed. Please download it first.',
      };
    }

    const modelPath = defaultModel.filePath ?? `/models/asr/${defaultModel.id}.gguf`;

    // Production guard: a registered model must actually exist on disk,
    // otherwise inference would feed a fake path to the native engine.
    // `/mock/` paths are test fixtures and intentionally skipped.
    if (
      !isMock &&
      defaultModel.filePath &&
      !defaultModel.filePath.startsWith('/mock/') &&
      !fs.existsSync(defaultModel.filePath)
    ) {
      logger.warn('ASR', `ASR model file does not exist on disk: ${defaultModel.filePath}`);
      return {
        status: 'error',
        code: 'ASR_MODEL_MISSING',
        message: 'ASR model file is missing. Please re-download it from the Models screen.',
      };
    }

    // 3. Read audio metadata and PCM (16 kHz mono only) when available
    let pcm: Uint8Array | null = null;
    let audioDurationMs = 3000;
    let pcmAvailable = false;

    if (!isMock && fs.existsSync(uri)) {
      try {
        const stats = fs.statSync(uri);
        const bytes = fs.readFileSync(uri);
        const parsed = extractPcmFromWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        if (parsed && parsed.sampleRate === 16000 && parsed.channels === 1) {
          pcm = parsed.pcm;
          pcmAvailable = true;
          audioDurationMs = Math.round(pcm.byteLength / BYTES_PER_MS);
        } else {
          audioDurationMs = estimateDurationFromBytes(stats.size);
        }
      } catch {
        audioDurationMs = estimateDurationFromBytes(fs.statSync(uri).size);
      }
    }

    // 4. Bilingual language strategy (Hinglish prompt + short-clip heuristic)
    const strategy = computeLanguageStrategy(opts.lang, audioDurationMs, opts.prompt);

    // 5. Segment long recordings at silence boundaries (prevents dropped audio)
    let segments: AudioSegment[] = [];
    if (pcmAvailable && pcm && audioDurationMs > MIN_SEGMENT_DURATION_MS) {
      segments = computeSegmentBoundaries(pcm, { maxSegmentMs: MIN_SEGMENT_DURATION_MS });
      logger.info('ASR', `Splitting ${audioDurationMs}ms audio into ${segments.length} segments`);
    }

    const useSegmentFiles = segments.length > 0;
    const segmentList: AudioSegment[] =
      segments.length > 0
        ? segments
        : [{ startByte: 0, endByte: pcm?.byteLength ?? 0, startMs: 0, endMs: audioDurationMs }];

    // 6. Run inference per segment (single pass for short clips)
    const transcriptParts: string[] = [];
    const langCounts: Record<'en' | 'hi', number> = { en: 0, hi: 0 };

    for (const segment of segmentList) {
      const segmentDurationMs = Math.max(segment.endMs - segment.startMs, 1);
      let segmentUri = uri;
      let cleanup: (() => void) | null = null;

      if (useSegmentFiles && pcm) {
        const written = writeSegmentWav(pcm, segment);
        segmentUri = written.path;
        cleanup = written.cleanup;
      }

      try {
        const inferenceResult = await runWhisperInference({
          audioUri: segmentUri,
          modelPath,
          language: strategy.language,
          initialPrompt: strategy.prompt,
          timeoutMs: computeTimeoutForDuration(segmentDurationMs, opts.timeoutMs),
        });

        const partText = inferenceResult.text.trim();
        if (partText) {
          transcriptParts.push(partText);
          langCounts[inferenceResult.detectedLang] += 1;
        }
      } finally {
        // Prime directive: delete every temp segment file immediately after ASR.
        cleanup?.();
      }
    }

    // 7. Merge, normalize, and validate output
    const rawMerged = transcriptParts.length > 1 ? mergeSegments(transcriptParts) : (transcriptParts[0] ?? '');
    const mergedText = normalizeTranscript(rawMerged);
    if (isEmptyTranscript(mergedText)) {
      return {
        status: 'error',
        code: 'ASR_EMPTY_OUTPUT',
        message: "Didn't catch that — try again",
      };
    }

    const detectedLang = dominantDetectedLang(langCounts, hasDevanagari(mergedText));

    // 8. Post-process Hindi romanization if configured
    let finalText = mergedText;
    if (detectedLang === 'hi' && opts.hindiOutput === 'romanized') {
      finalText = romanizeHindi(finalText);
      logger.info('ASR', 'Applied Hindi romanization post-processing');
    }

    const durationMs = Date.now() - startTime;
    logger.info('ASR', `Transcription completed in ${durationMs}ms (lang: ${detectedLang}): "${finalText}"`);

    return {
      status: 'ok',
      text: finalText,
      detectedLang,
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