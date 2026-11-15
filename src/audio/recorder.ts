import { Platform } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { wrapPcmWithWavHeader, calculateRms, calculateDurationMs, SAMPLE_RATE } from './wavUtils';
import { AudioMeteringData, RecordedAudio, RecordingState } from './types';
import { audioWorker } from '@/native/audioWorker';
import { nativeAudio } from '@/native/nativeAudio';
import { trimSilence } from './silenceTrim';
import { getRustCore } from '@/native/rustCore';
import { logger } from '@/utils/logger';

export type AudioDataListener = (chunk: Uint8Array, metering: AudioMeteringData) => void;

const PRE_ROLL_MS = 400; // 400ms pre-roll circular buffer
const TAIL_HANGOVER_MS = 400; // 400ms tail hangover delay on stop
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 32 bytes per ms
const MAX_PRE_ROLL_BYTES = PRE_ROLL_MS * BYTES_PER_MS; // 12,800 bytes

class AudioRecorderService {
  private state: RecordingState = 'idle';
  private pcmChunks: Uint8Array[] = [];
  private totalByteLength = 0;
  private preRollChunks: Uint8Array[] = [];
  private preRollByteLength = 0;
  private listeners: Set<AudioDataListener> = new Set();
  private workerUnsubscribe: (() => void) | null = null;
  private nativeMeteringUnsubscribe: (() => void) | null = null;
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
   * Starts capturing 16 kHz 16-bit mono PCM via native microphone or worker simulation.
   */
  public async start(): Promise<void> {
    if (this.state === 'recording') {
      logger.warn('AudioRecorder', 'Recording already in progress');
      return;
    }

    // Prepend pre-roll buffer so words spoken during touch/start latency are preserved
    this.pcmChunks = [...this.preRollChunks];
    this.totalByteLength = this.preRollByteLength;
    this.preRollChunks = [];
    this.preRollByteLength = 0;

    this.state = 'recording';
    this.startTime = Date.now();
    logger.info('AudioRecorder', `Starting audio recording at 16 kHz mono (prepended ${this.totalByteLength} pre-roll bytes)`);

    if (nativeAudio.isNativeAvailable) {
      this.nativeMeteringUnsubscribe = nativeAudio.addMeteringListener((metering) => {
        const dummyChunk = new Uint8Array(960);
        for (const listener of this.listeners) {
          try {
            listener(dummyChunk, metering);
          } catch (err) {
            logger.error('AudioRecorder', 'Error in audio listener', err);
          }
        }
      });
      if (typeof nativeAudio.startRollingRecording === 'function') {
        await nativeAudio.startRollingRecording({ maxDurationMs: 300000 });
      } else {
        await nativeAudio.startRecording();
      }
      return;
    }

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

    if (nativeAudio.isNativeAvailable) {
      this.state = 'processing';
      if (this.nativeMeteringUnsubscribe) {
        this.nativeMeteringUnsubscribe();
        this.nativeMeteringUnsubscribe = null;
      }

      if (typeof nativeAudio.stopRollingRecording === 'function') {
        const nativeRolling = await nativeAudio.stopRollingRecording();
        this.state = 'idle';
        if (!nativeRolling) {
          return null;
        }
        const trailingChunk = nativeRolling.trailingChunk || null;
        const trailingUri = trailingChunk?.uri || '';
        this.currentTempUri = trailingUri;
        const durationMs = nativeRolling.totalDurationMs || (trailingChunk?.durationMs ?? 0);
        const hasSpeech = (trailingChunk && trailingChunk.durationMs > 100) || durationMs > 500;
        return {
          uri: trailingUri,
          durationMs,
          sampleRate: SAMPLE_RATE,
          channels: 1,
          byteLength: 0,
          hasSpeech,
          trailingChunk,
        };
      }

      const nativeResult = await nativeAudio.stopRecording();
      this.state = 'idle';
      if (!nativeResult || !nativeResult.uri) {
        return null;
      }
      this.currentTempUri = nativeResult.uri;
      return {
        uri: nativeResult.uri,
        durationMs: nativeResult.durationMs,
        sampleRate: nativeResult.sampleRate,
        channels: nativeResult.channels,
        byteLength: nativeResult.byteLength,
        hasSpeech: nativeResult.hasSpeech,
      };
    }

    // Stop worker capture so synthetic simulation doesn't inject random noise
    if (this.workerUnsubscribe) {
      this.workerUnsubscribe();
      this.workerUnsubscribe = null;
    }
    await audioWorker.stopCapture();

    // Tail hangover: capture any trailing phonemes/words before cutoff
    await new Promise((resolve) => setTimeout(resolve, TAIL_HANGOVER_MS));

    this.state = 'processing';

    await audioWorker.stopCapture();

    const elapsedMs = Date.now() - this.startTime;
    logger.info('AudioRecorder', `Recording stopped. Total duration: ${elapsedMs}ms, bytes: ${this.totalByteLength}`);

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

    // Prepare temporary WAV output file path in cache directory
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `voicenote_temp_${Date.now()}.wav`);

    const rustCore = getRustCore();
    let hasSpeech = false;

    if (rustCore && typeof rustCore.trimAndSaveWav === 'function') {
      const pcmBuffer =
        mergedPcm.byteOffset === 0 && mergedPcm.byteLength === mergedPcm.buffer.byteLength
          ? mergedPcm.buffer
          : mergedPcm.buffer.slice(mergedPcm.byteOffset, mergedPcm.byteOffset + mergedPcm.byteLength);
      const res = rustCore.trimAndSaveWav(pcmBuffer, tempFile, 200);
      hasSpeech = res.hasSpeech;
    } else {
      // Apply automatic silence trimming with 200 ms phoneme padding
      const trimResult = trimSilence(mergedPcm, { paddingMs: 200, frameMs: 30 });
      hasSpeech = trimResult.hasSpeech;
      const finalPcm = trimResult.hasSpeech ? trimResult.trimmedPcm : mergedPcm;
      const wavBytes = wrapPcmWithWavHeader(finalPcm);
      fs.writeFileSync(tempFile, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));
    }

    this.currentTempUri = tempFile;
    this.state = 'idle';

    const fileExists = fs.existsSync(tempFile);
    const byteLength = fileExists ? fs.statSync(tempFile).size : 0;
    const durationMs = fileExists && byteLength >= 44
      ? calculateDurationMs(byteLength - 44)
      : 0;

    return {
      uri: tempFile,
      durationMs,
      sampleRate: SAMPLE_RATE,
      channels: 1,
      byteLength,
      hasSpeech,
    };
  }

  /**
   * Cancels recording and discards all buffers.
   */
  public async cancel(): Promise<void> {
    logger.info('AudioRecorder', 'Cancelling recording');
    if (this.nativeMeteringUnsubscribe) {
      this.nativeMeteringUnsubscribe();
      this.nativeMeteringUnsubscribe = null;
    }
    if (this.workerUnsubscribe) {
      this.workerUnsubscribe();
      this.workerUnsubscribe = null;
    }
    if (nativeAudio.isNativeAvailable) {
      if (typeof nativeAudio.cancelRollingRecording === 'function') {
        await nativeAudio.cancelRollingRecording();
      } else {
        await nativeAudio.cancelRecording();
      }
    } else {
      await audioWorker.stopCapture();
    }
    this.pcmChunks = [];
    this.totalByteLength = 0;
    await this.cleanupTempFile();
    this.state = 'idle';
  }

  /**
   * Initializes audio service and sweeps temporary directory for stranded audio chunks.
   */
  public async init(): Promise<void> {
    await this.cleanupOrphanedChunks();
  }

  /**
   * Startup sanitation sweep: deletes any stranded voicenote_chunk_*.wav files
   * left behind by previous aborted sessions or app crashes.
   */
  public async cleanupOrphanedChunks(): Promise<void> {
    try {
      const tempDir = os.tmpdir();
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          if (file.startsWith('voicenote_chunk_') && file.endsWith('.wav')) {
            const fullPath = path.join(tempDir, file);
            try {
              fs.unlinkSync(fullPath);
              logger.info('AudioRecorder', `Sanitation sweep deleted orphaned chunk: ${fullPath}`);
            } catch (err) {
              logger.warn('AudioRecorder', `Failed to delete orphaned chunk: ${fullPath}`, err);
            }
          }
        }
      }
    } catch (err) {
      logger.warn('AudioRecorder', 'Failed during startup orphaned chunk sanitation sweep', err);
    }
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
    if (this.state === 'idle') {
      // Keep in circular pre-roll buffer
      this.preRollChunks.push(chunk);
      this.preRollByteLength += chunk.length;

      // Evict oldest frames exceeding MAX_PRE_ROLL_BYTES
      while (this.preRollByteLength > MAX_PRE_ROLL_BYTES && this.preRollChunks.length > 0) {
        const evicted = this.preRollChunks.shift();
        if (evicted) {
          this.preRollByteLength -= evicted.length;
        }
      }
      return;
    }

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
