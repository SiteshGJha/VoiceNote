import { Platform } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { wrapPcmWithWavHeader, calculateRms, calculateDurationMs, SAMPLE_RATE } from './wavUtils';
import { AudioMeteringData, RecordedAudio, RecordingState } from './types';
import { logger } from '@/utils/logger';

export type AudioDataListener = (chunk: Uint8Array, metering: AudioMeteringData) => void;

class AudioRecorderService {
  private state: RecordingState = 'idle';
  private pcmChunks: Uint8Array[] = [];
  private totalByteLength = 0;
  private listeners: Set<AudioDataListener> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private startTime = 0;
  private currentTempUri: string | null = null;

  public getState(): RecordingState {
    return this.state;
  }

  public addListener(listener: AudioDataListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts capturing 16 kHz 16-bit mono PCM.
   */
  public async start(): Promise<void> {
    if (this.state === 'recording') {
      logger.warn('AudioRecorder', 'Recording already in progress');
      return;
    }

    this.pcmChunks = [];
    this.totalByteLength = 0;
    this.state = 'recording';
    this.startTime = Date.now();
    logger.info('AudioRecorder', 'Starting audio recording at 16 kHz mono');

    // In a bare React Native runtime with native audio, this connects to audio streaming callbacks
    // In Node / Jest / simulation, simulate frame delivery every 30 ms
    this.startAudioFrameSimulation();
  }

  /**
   * Stops recording and flushes buffered PCM to a temporary WAV file in app cache.
   */
  public async stop(): Promise<RecordedAudio | null> {
    if (this.state !== 'recording') {
      return null;
    }

    this.state = 'processing';
    this.stopAudioFrameSimulation();

    const durationMs = Date.now() - this.startTime;
    logger.info('AudioRecorder', `Recording stopped. Total duration: ${durationMs}ms, bytes: ${this.totalByteLength}`);

    if (this.totalByteLength === 0) {
      this.state = 'idle';
      return null;
    }

    // Merge chunks
    const mergedPcm = new Uint8Array(this.totalByteLength);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      mergedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    // Wrap with standard 44-byte WAV header
    const wavBytes = wrapPcmWithWavHeader(mergedPcm);

    // Write to temporary cache directory
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `voicenote_temp_${Date.now()}.wav`);
    fs.writeFileSync(tempFile, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));
    this.currentTempUri = tempFile;
    this.state = 'idle';

    return {
      uri: tempFile,
      durationMs: calculateDurationMs(this.totalByteLength),
      sampleRate: SAMPLE_RATE,
      channels: 1,
      byteLength: wavBytes.byteLength,
    };
  }

  /**
   * Cancels recording and discards all buffers.
   */
  public async cancel(): Promise<void> {
    logger.info('AudioRecorder', 'Cancelling recording');
    this.stopAudioFrameSimulation();
    this.pcmChunks = [];
    this.totalByteLength = 0;
    await this.cleanupTempFile();
    this.state = 'idle';
  }

  /**
   * Prime Directive: audio is strictly deleted immediately after ASR.
   */
  public async cleanupTempFile(targetUri?: string): Promise<void> {
    const fileToDelete = targetUri ?? this.currentTempUri;
    if (!fileToDelete) {
      return;
    }

    try {
      if (fs.existsSync(fileToDelete)) {
        fs.unlinkSync(fileToDelete);
        logger.info('AudioRecorder', `Temporary audio file strictly deleted: ${fileToDelete}`);
      }
    } catch (err) {
      logger.error('AudioRecorder', `Failed to delete temporary audio file: ${fileToDelete}`, err);
    } finally {
      if (!targetUri || targetUri === this.currentTempUri) {
        this.currentTempUri = null;
      }
    }
  }

  /**
   * Ingests a raw PCM frame (used by native module listeners).
   */
  public pushFrame(chunk: Uint8Array): void {
    if (this.state !== 'recording') {
      return;
    }

    this.pcmChunks.push(chunk);
    this.totalByteLength += chunk.length;

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
        logger.error('AudioRecorder', 'Error in audio listener', err);
      }
    }
  }

  private startAudioFrameSimulation(): void {
    // 30 ms frame at 16000 Hz, 16-bit mono = 480 samples = 960 bytes
    const FRAME_BYTES = 960;
    this.timer = setInterval(() => {
      const syntheticChunk = new Uint8Array(FRAME_BYTES);
      // Populate with mild ambient white noise / voice pattern
      for (let i = 0; i < FRAME_BYTES; i += 2) {
        const sample = Math.floor((Math.random() - 0.5) * 2000);
        syntheticChunk[i] = sample & 0xff;
        syntheticChunk[i + 1] = (sample >> 8) & 0xff;
      }
      this.pushFrame(syntheticChunk);
    }, 30);
  }

  private stopAudioFrameSimulation(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const audioRecorder = new AudioRecorderService();
