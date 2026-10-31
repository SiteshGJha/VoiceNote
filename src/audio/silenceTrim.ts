import { calculateRms, SAMPLE_RATE, BYTES_PER_SAMPLE } from './wavUtils';
import { logger } from '@/utils/logger';

export interface TrimOptions {
  speechThreshold?: number; // RMS threshold
  paddingMs?: number; // Kept audio before/after speech
  frameMs?: number; // Frame duration in ms
}

export interface TrimResult {
  trimmedPcm: Uint8Array;
  trimmedLeadingMs: number;
  trimmedTrailingMs: number;
  hasSpeech: boolean;
}

export const ABSOLUTE_SPEECH_FLOOR = 0.02;
export const LEGACY_SPEECH_CEILING = 0.04;
const ADAPTIVE_PERCENTILE = 0.35;
const ADAPTIVE_MULTIPLIER = 2;

/**
 * Adaptive speech threshold derived from the clip's own energy distribution.
 *
 * Uses a low percentile of frame RMS x2, bounded to <= the legacy fixed 0.04
 * ceiling. Bounding the ceiling means the threshold is NEVER less sensitive
 * than the old behavior, while quiet clips (soft speech onset) get a lower
 * threshold so early spoken words are no longer trimmed as "silence".
 */
export function computeAdaptiveSpeechThreshold(rmsValues: number[]): number {
  if (rmsValues.length === 0) {
    return ABSOLUTE_SPEECH_FLOOR;
  }
const sorted = [...rmsValues].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ADAPTIVE_PERCENTILE));
  const quietFrameRms = sorted[index] ?? 0;
  const candidate = quietFrameRms * ADAPTIVE_MULTIPLIER;
  return Math.max(ABSOLUTE_SPEECH_FLOOR, Math.min(LEGACY_SPEECH_CEILING, candidate));
}

/**
 * Trims leading and trailing silence from 16 kHz 16-bit mono PCM.
 * Retains paddingMs (default 200 ms) around speech to avoid clipping phonemes.
 * Uses an adaptive, clip-relative threshold so quiet early speech is preserved.
 */
export function trimSilence(
  pcmBytes: Uint8Array,
  options: TrimOptions = {}
): TrimResult {
  const frameMs = options.frameMs ?? 30;
  const paddingMs = options.paddingMs ?? 200;

  const bytesPerMs = (SAMPLE_RATE * BYTES_PER_SAMPLE) / 1000;
  const frameBytes = Math.floor(frameMs * bytesPerMs);
  const paddingBytes = Math.floor(paddingMs * bytesPerMs);

  if (pcmBytes.length < frameBytes) {
    return {
      trimmedPcm: pcmBytes,
      trimmedLeadingMs: 0,
      trimmedTrailingMs: 0,
      hasSpeech: false,
    };
  }

  const totalFrames = Math.floor(pcmBytes.length / frameBytes);

  // Pass 1: measure energy of every frame, then derive a clip-relative threshold
  const rmsValues: number[] = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const start = i * frameBytes;
    const frameSlice = pcmBytes.subarray(start, start + frameBytes);
    rmsValues[i] = calculateRms(frameSlice).normalized;
  }

  const threshold = options.speechThreshold ?? computeAdaptiveSpeechThreshold(rmsValues);

  // Pass 2: classify frames as speech using the (possibly lower) threshold
  const speechFrames: boolean[] = new Array(totalFrames);
  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;

  for (let i = 0; i < totalFrames; i++) {
    const isSpeech = (rmsValues[i] ?? 0) >= threshold;
    speechFrames[i] = isSpeech;

    if (isSpeech) {
      if (firstSpeechFrame === -1) {
        firstSpeechFrame = i;
      }
      lastSpeechFrame = i;
    }
  }

  // All silence detected
  if (firstSpeechFrame === -1 || lastSpeechFrame === -1) {
    logger.info('SilenceTrim', 'No speech detected in audio stream');
    return {
      trimmedPcm: new Uint8Array(0),
      trimmedLeadingMs: Math.round(pcmBytes.length / bytesPerMs),
      trimmedTrailingMs: 0,
      hasSpeech: false,
    };
  }

  const speechStartByte = firstSpeechFrame * frameBytes;
  const speechEndByte = (lastSpeechFrame + 1) * frameBytes;

  // Apply padding while clamping to buffer boundaries
  const trimmedStartByte = Math.max(0, speechStartByte - paddingBytes);
  const trimmedEndByte = Math.min(pcmBytes.length, speechEndByte + paddingBytes);

  const trimmedPcm = pcmBytes.slice(trimmedStartByte, trimmedEndByte);
  const trimmedLeadingMs = Math.round(trimmedStartByte / bytesPerMs);
  const trimmedTrailingMs = Math.round((pcmBytes.length - trimmedEndByte) / bytesPerMs);

  logger.info(
    'SilenceTrim',
    `Trimmed ${trimmedLeadingMs}ms leading, ${trimmedTrailingMs}ms trailing silence. Remaining bytes: ${trimmedPcm.length}`
  );

  return {
    trimmedPcm,
    trimmedLeadingMs,
    trimmedTrailingMs,
    hasSpeech: true,
  };
}
