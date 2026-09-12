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

/**
 * Trims leading and trailing silence from 16 kHz 16-bit mono PCM.
 * Retains paddingMs (default 200 ms) around speech to avoid clipping phonemes.
 */
export function trimSilence(
  pcmBytes: Uint8Array,
  options: TrimOptions = {}
): TrimResult {
  const frameMs = options.frameMs ?? 30;
  const paddingMs = options.paddingMs ?? 200;
  const threshold = options.speechThreshold ?? 0.04;

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
  const speechFrames: boolean[] = new Array(totalFrames);

  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;

  for (let i = 0; i < totalFrames; i++) {
    const start = i * frameBytes;
    const frameSlice = pcmBytes.subarray(start, start + frameBytes);
    const { normalized } = calculateRms(frameSlice);

    const isSpeech = normalized >= threshold;
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
