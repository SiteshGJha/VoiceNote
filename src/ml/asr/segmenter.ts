import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SAMPLE_RATE, BYTES_PER_SAMPLE, calculateRms, wrapPcmWithWavHeader } from '@/audio/wavUtils';
import { logger } from '@/utils/logger';

/**
 * Long-audio segmentation for Whisper.
 *
 * whisper.cpp processes audio in an internal ~30s window. On long recordings
 * (meetings, multiple dictations) speech at window boundaries and trailing
 * audio can be dropped. This module slices a 16 kHz mono WAV into <= maxSegmentMs
 * chunks, cutting at the longest silence gap so words are never split, and
 * writes each slice to a temp WAV for per-segment transcription.
 *
 * Temp segment files MUST be deleted by the caller (see Privacy guarantees).
 */

export interface WaveData {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface AudioSegment {
  startByte: number;
  endByte: number;
  startMs: number;
  endMs: number;
}

export interface SegmentationOptions {
  /** Target max segment length in ms (Whisper window is 30s; leave headroom). */
  maxSegmentMs?: number;
  /** Silence gap (ms) considered a valid cut point. */
  minSilenceMs?: number;
  /** Frame duration used for energy analysis. */
  frameMs?: number;
  /** Extra audio kept after the cut point to protect phonemes. */
  overlapMs?: number;
}

const DEFAULT_MAX_SEGMENT_MS = 27_000;
const DEFAULT_MIN_SILENCE_MS = 200;
const DEFAULT_FRAME_MS = 30;
const DEFAULT_OVERLAP_MS = 250;

const BYTES_PER_MS = (SAMPLE_RATE * BYTES_PER_SAMPLE) / 1000;

function asciiId(bytes: Uint8Array, start: number, length: number): string {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += String.fromCharCode(bytes[start + i] ?? 0);
  }
  return id;
}

/**
 * Parses a RIFF/WAVE file, locating the actual `data` chunk (handles WAVs
 * with extra chunks between the header and payload).
 */
export function extractPcmFromWav(wavBytes: Uint8Array): WaveData | null {
  if (!wavBytes || wavBytes.length < 44) {
    return null;
  }
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  if (asciiId(wavBytes, 0, 4) !== 'RIFF' || asciiId(wavBytes, 8, 4) !== 'WAVE') {
    return null;
  }

  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);

  let offset = 12;
  while (offset + 8 <= wavBytes.length) {
    const id = asciiId(wavBytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const dataStart = offset + 8;
      const pcm = wavBytes.subarray(dataStart, Math.min(dataStart + size, wavBytes.length));
      return { pcm, sampleRate, channels, bitsPerSample };
    }
    offset += 8 + size + (size % 2);
  }

  return null;
}

/**
 * Computes silence gaps (byte ranges) from 16-bit PCM using RMS energy.
 */
function findSilenceGaps(
  pcm: Uint8Array,
  frameMs: number,
  minSilenceMs: number,
  threshold = 0.04
): Array<{ startByte: number; endByte: number; gapMs: number }> {
  const frameBytes = Math.floor(frameMs * BYTES_PER_MS);
  if (pcm.length < frameBytes) {
    return [];
  }

  const totalFrames = Math.floor(pcm.length / frameBytes);
  const frames = new Array<boolean>(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    const start = i * frameBytes;
    const slice = pcm.subarray(start, start + frameBytes);
    frames[i] = calculateRms(slice).normalized < threshold;
  }

  const gaps: Array<{ startByte: number; endByte: number; gapMs: number }> = [];
  let gapStart = -1;
  let gapEnd = -1;

  for (let i = 0; i <= totalFrames; i++) {
    const silent = i < totalFrames ? frames[i] : false;
    if (silent && gapStart === -1) {
      gapStart = i;
    } else if (!silent && gapStart !== -1) {
      gapEnd = i; // exclusive
      const gapMs = (gapEnd - gapStart) * frameMs;
      if (gapMs >= minSilenceMs) {
        gaps.push({
          startByte: gapStart * frameBytes,
          endByte: gapEnd * frameBytes,
          gapMs,
        });
      }
      gapStart = -1;
    }
  }

  return gaps;
}

/**
 * Splits PCM into segments of at most `maxSegmentMs`, cutting at the longest
 * silence gap available inside each window and adding `overlapMs` of audio
 * after each cut to avoid clipped phonemes.
 */
export function computeSegmentBoundaries(
  pcm: Uint8Array,
  options: SegmentationOptions = {}
): AudioSegment[] {
  const maxSegmentMs = options.maxSegmentMs ?? DEFAULT_MAX_SEGMENT_MS;
  const minSilenceMs = options.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS;
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;

  const maxSegmentBytes = Math.floor(maxSegmentMs * BYTES_PER_MS);
  if (pcm.length <= maxSegmentBytes) {
    return [{ startByte: 0, endByte: pcm.length, startMs: 0, endMs: Math.round(pcm.length / BYTES_PER_MS) }];
  }

  const gaps = findSilenceGaps(pcm, frameMs, minSilenceMs);
  const overlapBytes = Math.floor(overlapMs * BYTES_PER_MS);
  const minimumProgressBytes = frameMs * BYTES_PER_MS;
  const segments: AudioSegment[] = [];
  let cursor = 0;
  let guard = 0;

  while (cursor < pcm.length) {
    const windowEnd = Math.min(cursor + maxSegmentBytes, pcm.length);

    // Prefer the longest silence gap fully inside this window as the cut point.
    let bestGap: { startByte: number; endByte: number; gapMs: number } | null = null;
    for (const gap of gaps) {
      if (gap.startByte >= cursor && gap.endByte <= windowEnd) {
        if (bestGap === null || gap.gapMs > bestGap.gapMs) {
          bestGap = gap;
        }
      }
    }

    let cutEnd = windowEnd;
    let overlapUsed = 0;
    if (bestGap) {
      // Cut through the middle of the silence gap (keeps both flanks padded).
      cutEnd = bestGap.startByte + Math.floor((bestGap.endByte - bestGap.startByte) / 2);
      overlapUsed = overlapBytes;
    }

    // Clamp: at least one frame of progress, never exceed the window + overlap.
    const endByte = Math.min(
      pcm.length,
      Math.max(cutEnd, cursor + minimumProgressBytes),
      windowEnd + overlapUsed
    );

    segments.push({
      startByte: cursor,
      endByte,
      startMs: Math.round(cursor / BYTES_PER_MS),
      endMs: Math.round(endByte / BYTES_PER_MS),
    });

    if (endByte <= cursor) {
      logger.warn('Segmenter', 'Zero-progress cut detected; forcing forward');
      cursor = Math.min(pcm.length, windowEnd);
    } else {
      cursor = endByte;
    }

    guard += 1;
    if (guard > 1000) {
      logger.warn('Segmenter', 'Segment guard reached; stopping');
      break;
    }
  }

  return segments;
}

export interface WrittenSegment {
  path: string;
  cleanup: () => void;
}

/**
 * Writes a slice of PCM to a temp WAV and returns a cleanup function that
 * deletes the file (strictly after the segment is transcribed).
 */
export function writeSegmentWav(pcm: Uint8Array, segment: AudioSegment): WrittenSegment {
  const slice = pcm.slice(segment.startByte, segment.endByte);
  const wavBytes = wrapPcmWithWavHeader(slice);
  const tempFile = path.join(os.tmpdir(), `voicenote_segment_${Date.now()}_${Math.floor(Math.random() * 100000)}.wav`);
  fs.writeFileSync(tempFile, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));

  return {
    path: tempFile,
    cleanup: () => {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          logger.info('Segmenter', `Deleted segment temp file: ${tempFile}`);
        }
      } catch (err) {
        logger.error('Segmenter', `Failed to delete segment temp file: ${tempFile}`, err);
      }
    },
  };
}