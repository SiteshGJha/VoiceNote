import * as fs from 'fs';
import { computeSegmentBoundaries, extractPcmFromWav, writeSegmentWav, AudioSegment } from '@/ml/asr/segmenter';
import { wrapPcmWithWavHeader } from '@/audio/wavUtils';
import { SAMPLE_RATE, BYTES_PER_SAMPLE } from '@/audio/wavUtils';

const FRAME_BYTES = 30 * (SAMPLE_RATE * BYTES_PER_SAMPLE) / 1000; // 960 bytes = 30ms

function createFrame(level: number): Uint8Array {
  const frame = new Uint8Array(FRAME_BYTES);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < frame.length / 2; i++) {
    view.setInt16(i * 2, level, true);
  }
  return frame;
}

function buildPcm(blocks: Array<{ level: number; frames: number }>): Uint8Array {
  const totalFrames = blocks.reduce((sum, b) => sum + b.frames, 0);
  const pcm = new Uint8Array(totalFrames * FRAME_BYTES);
  let offset = 0;
  for (const block of blocks) {
    const frame = createFrame(block.level);
    for (let i = 0; i < block.frames; i++) {
      pcm.set(frame, offset);
      offset += FRAME_BYTES;
    }
  }
  return pcm;
}

describe('ASR WAV Parsing & Segmentation', () => {
  it('extracts PCM from a standard WAV with sample rate/channels', () => {
    const pcm = createFrame(3000);
    const wav = wrapPcmWithWavHeader(pcm);
    const parsed = extractPcmFromWav(wav);

    expect(parsed).not.toBeNull();
    expect(parsed?.sampleRate).toBe(16000);
    expect(parsed?.channels).toBe(1);
    expect(parsed?.bitsPerSample).toBe(16);
    expect(parsed?.pcm.length).toBe(pcm.length);
  });

  it('rejects non-WAV buffers', () => {
    expect(extractPcmFromWav(new Uint8Array(10))).toBeNull();
    const junk = new Uint8Array(100);
    junk.set([0x4e, 0x4f, 0x54, 0x46], 0); // "NOTF"
    expect(extractPcmFromWav(junk)).toBeNull();
  });

  it('returns a single segment for audio within the window', () => {
    const pcm = buildPcm([{ level: 3000, frames: 60 }]); // 1.8s
    const segments = computeSegmentBoundaries(pcm, { maxSegmentMs: 3000 });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.startByte).toBe(0);
    expect(segments[0]?.endByte).toBe(pcm.length);
  });

  it('splits long audio at silence boundaries without exceeding the window', () => {
    // Speech 40f, silence 20f (600ms gap) repeated: 4 speech blocks @40f + 3 gaps @20f
    const blocks: Array<{ level: number; frames: number }> = [];
    for (let i = 0; i < 4; i++) {
      blocks.push({ level: 3000, frames: 40 }, { level: 0, frames: 20 });
    }
    const pcm = buildPcm(blocks); // 4*40 + 4*20 = 240 frames = 7.2s
    const maxSegmentMs = 3000;
    const overlapMs = 250;

    const segments = computeSegmentBoundaries(pcm, { maxSegmentMs, minSilenceMs: 300, overlapMs });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.startByte).toBe(0);
    expect(segments[segments.length - 1]?.endByte).toBe(pcm.length);

    for (const seg of segments) {
      const durMs = seg.endMs - seg.startMs;
      expect(durMs).toBeLessThanOrEqual(maxSegmentMs + overlapMs + 60); // 60ms frame tolerance
      expect(durMs).toBeGreaterThan(0);
      // Last frame of each non-final segment should be silence (cut at a gap)
      if (seg.endByte < pcm.length) {
        const lastFrame = pcm.subarray(seg.endByte - FRAME_BYTES, seg.endByte);
        const view = new DataView(lastFrame.buffer, lastFrame.byteOffset, lastFrame.byteLength);
        let peak = 0;
        for (let i = 0; i < lastFrame.length / 2; i++) {
          peak = Math.max(peak, Math.abs(view.getInt16(i * 2, true)));
        }
        expect(peak).toBe(0);
      }
    }
  });

  it('writes temp segment WAV and deletes it on cleanup', () => {
    const pcm = buildPcm([{ level: 3000, frames: 30 }]);
    const segment: AudioSegment = { startByte: 0, endByte: pcm.length, startMs: 0, endMs: 900 };
    const written = writeSegmentWav(pcm, segment);

    expect(fs.existsSync(written.path)).toBe(true);
    const raw = fs.readFileSync(written.path);
    expect(raw.length).toBeGreaterThan(44);

    written.cleanup();
    expect(fs.existsSync(written.path)).toBe(false);
  });
});