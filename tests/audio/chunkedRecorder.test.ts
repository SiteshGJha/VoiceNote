import { ChunkedRecorder, AudioSegment } from '@/audio/chunkedRecorder';
import { SegmentQueue } from '@/audio/segmentQueue';

describe('Chunked Audio Recording & Segment Queue', () => {
  it('emits a single segment on stop if recording duration is under 25s', async () => {
    const emittedSegments: AudioSegment[] = [];
    const recorder = new ChunkedRecorder({
      onSegment: (seg) => emittedSegments.push(seg),
    });

    await recorder.start();
    // Simulate feeding 10 seconds of 16kHz PCM (160,000 samples)
    const samples = new Float32Array(16000 * 10);
    recorder.processFrame(samples);

    const segments = await recorder.stop();
    expect(segments).toHaveLength(1);
    expect(segments[0]?.isLast).toBe(true);
    expect(segments[0]?.durationMs).toBe(10000);
  });

  it('splits recordings longer than 25s into 30s segments with 5s overlap', async () => {
    const emittedSegments: AudioSegment[] = [];
    const recorder = new ChunkedRecorder({
      onSegment: (seg) => emittedSegments.push(seg),
    });

    await recorder.start();
    // Feed 35 seconds of audio (560,000 samples) in 5-second increments
    for (let i = 0; i < 7; i++) {
      recorder.processFrame(new Float32Array(16000 * 5));
    }

    const segments = await recorder.stop();
    // Segment 0: 0-30s (non-overlap emit trigger at 25s)
    // Segment 1: 25s-35s (10s duration, including 5s overlap with previous)
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]?.durationMs).toBe(30000);
    expect(segments[0]?.isLast).toBe(false);
    expect(segments[segments.length - 1]?.isLast).toBe(true);
  });

  it('triggers duration warning at 25 minutes and hard cap at 30 minutes', async () => {
    let warningTriggered = false;
    let limitTriggered = false;

    const recorder = new ChunkedRecorder({
      onDurationWarning: () => {
        warningTriggered = true;
      },
      onLimitReached: () => {
        limitTriggered = true;
      },
    });

    await recorder.start();

    // Fast-forward samples to 25 minutes (25 * 60 * 16000 samples)
    const twentyFiveMinSamples = 25 * 60 * 16000;
    recorder.processFrame(new Float32Array(twentyFiveMinSamples));
    expect(warningTriggered).toBe(true);

    // Feed another 5 minutes to hit 30 minutes
    const fiveMinSamples = 5 * 60 * 16000;
    recorder.processFrame(new Float32Array(fiveMinSamples));
    expect(limitTriggered).toBe(true);

    await recorder.stop();
  });

  it('SegmentQueue executes asynchronous segment processor sequentially', async () => {
    const queue = new SegmentQueue();
    const processedOrder: number[] = [];

    const mockTranscriber = async (seg: AudioSegment): Promise<string> => {
      // Simulate random latency to verify strict sequential processing
      const delay = seg.index === 0 ? 50 : 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      processedOrder.push(seg.index);
      return `Segment ${seg.index}`;
    };

    queue.enqueue(
      { index: 0, pcm: new Float32Array(16000), startMs: 0, durationMs: 1000, isLast: false },
      mockTranscriber
    );
    queue.enqueue(
      { index: 1, pcm: new Float32Array(16000), startMs: 1000, durationMs: 1000, isLast: true },
      mockTranscriber
    );

    const transcripts = await queue.flush();
    expect(processedOrder).toEqual([0, 1]);
    expect(transcripts).toEqual(['Segment 0', 'Segment 1']);
  });
});
