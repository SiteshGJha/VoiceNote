/**
 * Audio Segment representation.
 */
export interface AudioSegment {
  index: number;
  pcm: Float32Array;
  startMs: number;
  durationMs: number;
  isLast: boolean;
}

export interface ChunkedRecorderOptions {
  sampleRate?: number | undefined; // Default 16000
  segmentDurationSec?: number | undefined; // Default 30s
  overlapSec?: number | undefined; // Default 5s
  onSegment?: ((seg: AudioSegment) => void) | undefined;
  onDurationWarning?: ((remainingMs: number) => void) | undefined;
  onLimitReached?: (() => void) | undefined;
}

const SAMPLE_RATE = 16000;
const SEGMENT_DURATION_SEC = 30;
const OVERLAP_SEC = 5;
const STEP_SEC = SEGMENT_DURATION_SEC - OVERLAP_SEC; // 25s step between segment starts
const WARNING_MS = 25 * 60 * 1000; // 25 minutes
const LIMIT_MS = 30 * 60 * 1000; // 30 minutes

export class ChunkedRecorder {
  private readonly options: ChunkedRecorderOptions;
  private readonly sampleRate: number;
  private readonly segmentSamples: number;
  private readonly overlapSamples: number;
  private readonly stepSamples: number;

  private isRecording: boolean = false;
  private totalSamplesRecorded: number = 0;
  private emittedSegments: AudioSegment[] = [];
  private currentSegmentIndex: number = 0;
  private buffer: Float32Array = new Float32Array(0);
  private warningFired: boolean = false;
  private limitFired: boolean = false;

  constructor(options?: ChunkedRecorderOptions) {
    this.options = options ?? {};
    this.sampleRate = this.options.sampleRate ?? SAMPLE_RATE;
    const segSec = this.options.segmentDurationSec ?? SEGMENT_DURATION_SEC;
    const overlapSec = this.options.overlapSec ?? OVERLAP_SEC;
    this.segmentSamples = segSec * this.sampleRate;
    this.overlapSamples = overlapSec * this.sampleRate;
    this.stepSamples = (segSec - overlapSec) * this.sampleRate;
  }

  public async start(): Promise<void> {
    this.isRecording = true;
    this.totalSamplesRecorded = 0;
    this.emittedSegments = [];
    this.currentSegmentIndex = 0;
    this.buffer = new Float32Array(0);
    this.warningFired = false;
    this.limitFired = false;
  }

  public processFrame(samples: Float32Array): void {
    if (!this.isRecording) return;

    this.totalSamplesRecorded += samples.length;
    const currentDurationMs = (this.totalSamplesRecorded / this.sampleRate) * 1000;

    // Check 25-minute warning
    if (!this.warningFired && currentDurationMs >= WARNING_MS) {
      this.warningFired = true;
      const remainingMs = Math.max(0, LIMIT_MS - currentDurationMs);
      this.options.onDurationWarning?.(remainingMs);
    }

    // Check 30-minute limit
    if (!this.limitFired && currentDurationMs >= LIMIT_MS) {
      this.limitFired = true;
      this.options.onLimitReached?.();
    }

    // Append to rolling buffer
    const nextBuf = new Float32Array(this.buffer.length + samples.length);
    nextBuf.set(this.buffer, 0);
    nextBuf.set(samples, this.buffer.length);
    this.buffer = nextBuf;

    // Check if we reached a segment boundary (30s)
    while (this.buffer.length >= this.segmentSamples) {
      const segPcm = this.buffer.slice(0, this.segmentSamples);
      const segment: AudioSegment = {
        index: this.currentSegmentIndex,
        pcm: segPcm,
        startMs: (this.currentSegmentIndex * this.stepSamples * 1000) / this.sampleRate,
        durationMs: (this.segmentSamples * 1000) / this.sampleRate,
        isLast: false,
      };

      this.emittedSegments.push(segment);
      this.options.onSegment?.(segment);
      this.currentSegmentIndex++;

      // Retain overlap for next segment
      this.buffer = this.buffer.slice(this.stepSamples);
    }
  }

  public async stop(): Promise<AudioSegment[]> {
    this.isRecording = false;

    // Emit any remaining audio as final segment
    if (this.buffer.length > 0 || this.emittedSegments.length === 0) {
      const durationMs = Math.round((this.buffer.length / this.sampleRate) * 1000);
      const finalSeg: AudioSegment = {
        index: this.currentSegmentIndex,
        pcm: this.buffer,
        startMs: (this.currentSegmentIndex * this.stepSamples * 1000) / this.sampleRate,
        durationMs: Math.max(durationMs, 0),
        isLast: true,
      };
      this.emittedSegments.push(finalSeg);
      this.options.onSegment?.(finalSeg);
    } else if (this.emittedSegments.length > 0) {
      const last = this.emittedSegments[this.emittedSegments.length - 1];
      if (last) {
        last.isLast = true;
      }
    }

    const result = [...this.emittedSegments];
    this.buffer = new Float32Array(0);
    return result;
  }

  public cancel(): void {
    this.isRecording = false;
    this.buffer = new Float32Array(0);
    this.emittedSegments = [];
  }
}
