import { Platform } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { wrapPcmWithWavHeader, calculateRms, calculateDurationMs, SAMPLE_RATE } from './wavUtils';
import { AudioMeteringData, RecordedAudio, RecordingState } from './types';
import { audioWorker } from '@/native/audioWorker';
import { trimSilence } from './silenceTrim';
import { logger } from '@/utils/logger';

export type AudioDataListener = (chunk: Uint8Array, metering: AudioMeteringData) => void;

class AudioRecorderService {
  private state: RecordingState = 'idle';
  private pcmChunks: Uint8Array[] = [];
  private totalByteLength = 0;
  private listeners: Set<AudioDataListener> = new Set();
  private workerUnsubscribe: (() => void) | null = null;
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
   * Starts capturing 16 kHz 16-bit mono PCM via background audio capture worker.
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

    this.workerUnsubscribe = audioWorker.addListener((chunk, metering) => {
      this.pushFrame(chunk, metering);
    });

    await audioWorker.startCapture();
  }

  /**
   * Stops recording and flushes trimmed PCM to a temporary WAV file in app cache.
   */
  public async stop(): Promise<RecordedAudio | null> {
    if (this.state !== 'recording') {
      return null;
    }

    this.state = 'processing';
    if (this.workerUnsubscribe) {
      this.workerUnsubscribe();
      this.workerUnsubscribe = null;
    }
    await audioWorker.stopCapture();

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

    // Apply automatic silence trimming with 200 ms phoneme padding
    const trimResult = trimSilence(mergedPcm, { paddingMs: 200, frameMs: 30 });
    const finalPcm = trimResult.hasSpeech ? trimResult.trimmedPcm : mergedPcm;

    // Wrap with standard 44-byte WAV header
    const wavBytes = wrapPcmWithWavHeader(finalPcm);

    // Write to temporary cache directory
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `voicenote_temp_${Date.now()}.wav`);
    fs.writeFileSync(tempFile, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));
    this.currentTempUri = tempFile;
    this.state = 'idle';

    return {
      uri: tempFile,
      durationMs: calculateDurationMs(finalPcm.byteLength),
      sampleRate: SAMPLE_RATE,
      channels: 1,
      byteLength: wavBytes.byteLength,
      hasSpeech: trimResult.hasSpeech,
    };
  }

  /**
   * Cancels recording and discards all buffers.
   */
  public async cancel(): Promise<void> {
    logger.info('AudioRecorder', 'Cancelling recording');
    if (this.workerUnsubscribe) {
      this.workerUnsubscribe();
      this.workerUnsubscribe = null;
    }
    await audioWorker.stopCapture();
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
   * Ingests a raw PCM frame (used by background worker / native audio listeners).
   */
  public pushFrame(chunk: Uint8Array, precomputedMetering?: AudioMeteringData): void {
    if (this.state !== 'recording') {
      return;
    }

    this.pcmChunks.push(chunk);
    this.totalByteLength += chunk.length;

    let metering = precomputedMetering;
    if (!metering) {
      const { rms, normalized } = calculateRms(chunk);
      metering = {
        amplitude: normalized,
        rawRms: rms,
        peak: rms * 1.414,
      };
    }

    for (const listener of this.listeners) {
      try {
        listener(chunk, metering);
      } catch (err) {
        logger.error('AudioRecorder', 'Error in audio listener', err);
      }
    }
  }
}

export const audioRecorder = new AudioRecorderService();
