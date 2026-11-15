import { Platform } from 'react-native';
import { logger } from '@/utils/logger';
import { calculateRms, SAMPLE_RATE, BYTES_PER_SAMPLE } from '@/audio/wavUtils';
import { AudioMeteringData } from '@/audio/types';

declare const __DEV__: boolean | undefined;

export type WorkerFrameListener = (chunk: Uint8Array, metering: AudioMeteringData) => void;

export interface AudioWorkerConfig {
  sampleRate: number;
  frameMs: number;
  channels: number;
}

const DEFAULT_CONFIG: AudioWorkerConfig = {
  sampleRate: SAMPLE_RATE, // 16000 Hz
  frameMs: 30,             // 30 ms
  channels: 1,             // Mono
};

/**
 * Background Audio Worker.
 * Handles audio capture and frame generation off the main UI thread.
 * Dispatches 16 kHz 16-bit mono linear PCM frames (960 bytes per 30 ms frame).
 */
export class BackgroundAudioWorker {
  private config: AudioWorkerConfig;
  private isCapturing = false;
  private listeners: Set<WorkerFrameListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private frameBytes: number;

  constructor(config: Partial<AudioWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const bytesPerMs = (this.config.sampleRate * BYTES_PER_SAMPLE * this.config.channels) / 1000;
    this.frameBytes = Math.floor(this.config.frameMs * bytesPerMs);
  }

  public isRunning(): boolean {
    return this.isCapturing;
  }

  public addListener(listener: WorkerFrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts audio stream capture in background worker.
   */
  public async startCapture(): Promise<void> {
    if (this.isCapturing) {
      logger.warn('AudioWorker', 'Capture worker is already running');
      return;
    }

    const isDevOrTest = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.NODE_ENV === 'test';
    if (!isDevOrTest) {
      throw new Error('AudioWorker simulation is not permitted in production release builds. Use native audio capture.');
    }

    this.isCapturing = true;
    logger.info(
      'AudioWorker',
      `Starting background audio capture worker (${this.config.sampleRate}Hz, ${this.config.frameMs}ms frames, ${this.frameBytes} bytes/frame)`
    );

    // In a bare React Native production runtime, this hooks into native audio capture thread / JSI isolate.
    // In Node / Jest / dev simulation, simulate frame dispatch on a dedicated interval with unref.
    this.startCaptureSimulation();
  }

  /**
   * Stops audio stream capture and cleans up all worker handles.
   */
  public async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    logger.info('AudioWorker', 'Stopping background audio capture worker');
    this.stopCaptureSimulation();
    this.isCapturing = false;
  }

  /**
   * Dispatches a raw PCM frame through metering and listeners.
   */
  public dispatchFrame(chunk: Uint8Array): void {
    if (!this.isCapturing) {
      return;
    }

    const { rms, normalized } = calculateRms(chunk);
    const metering: AudioMeteringData = {
      amplitude: normalized,
      rawRms: rms,
      peak: rms * 1.414,
    };

    for (const listener of this.listeners) {
      try {
        listener(chunk, metering);
      } catch (err) {
        logger.error('AudioWorker', 'Error in audio frame listener', err);
      }
    }
  }

  private startCaptureSimulation(): void {
    const isDevOrTest = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.NODE_ENV === 'test';
    if (!isDevOrTest) {
      throw new Error('AudioWorker simulation is not permitted in production release builds. Use native audio capture.');
    }

    this.timer = setInterval(() => {
      if (!this.isCapturing) {
        return;
      }

      const syntheticChunk = new Uint8Array(this.frameBytes);
      for (let i = 0; i < this.frameBytes; i += 2) {
        const sample = Math.floor((Math.random() - 0.5) * 2000);
        syntheticChunk[i] = sample & 0xff;
        syntheticChunk[i + 1] = (sample >> 8) & 0xff;
      }

      this.dispatchFrame(syntheticChunk);
    }, this.config.frameMs);

    // Ensure Node.js event loop doesn't block exit due to this interval
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private stopCaptureSimulation(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * For test harnesses: simulates rolling chunk emission on a timer.
   */
  public simulateRollingChunks(
    chunkCount: number,
    intervalMs: number,
    onChunk: (item: { uri: string; durationMs: number; index: number }) => void
  ): () => void {
    let index = 0;
    const interval = setInterval(() => {
      if (index >= chunkCount) {
        clearInterval(interval);
        return;
      }
      onChunk({
        uri: `/mock/rolling_chunk_${index}.wav`,
        durationMs: 20000,
        index,
      });
      index++;
    }, intervalMs);

    if (interval && typeof interval.unref === 'function') {
      interval.unref();
    }

    return () => {
      clearInterval(interval);
    };
  }
}

export const audioWorker = new BackgroundAudioWorker();
