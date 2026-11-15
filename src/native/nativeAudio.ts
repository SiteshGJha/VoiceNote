import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { logger } from '@/utils/logger';
import { ChunkReadyEvent, SegmentedAudioItem } from '@/pipeline/types';

export type { ChunkReadyEvent };

export interface NativeAudioRecordingResult {
  uri: string;
  durationMs: number;
  byteLength: number;
  hasSpeech: boolean;
  sampleRate: number;
  channels: number;
}

export interface NativeRollingRecordingResult {
  sessionId: string;
  totalDurationMs: number;
  trailingChunk?: SegmentedAudioItem;
}

export interface NativeAudioTranscriptionResult {
  text: string;
  detectedLang: 'en' | 'hi';
  durationMs: number;
}

export interface NativeAudioMeteringEvent {
  amplitude: number;
  rawRms: number;
  peak: number;
}

export class NativeAudioBridge {
  private eventEmitter: NativeEventEmitter | null = null;

  private get nativeModule() {
    return NativeModules?.VoiceNoteNativeAudio;
  }

  public get isNativeAvailable(): boolean {
    const mod = this.nativeModule;
    return !!(mod && typeof mod.startRecording === 'function');
  }

  private getEventEmitter(): NativeEventEmitter | null {
    const mod = this.nativeModule;
    if (!this.eventEmitter && mod) {
      try {
        this.eventEmitter = new NativeEventEmitter(mod);
      } catch (err) {
        logger.warn('NativeAudio', 'Failed to initialize NativeEventEmitter for VoiceNoteNativeAudio', err);
      }
    }
    return this.eventEmitter;
  }

  public async startRecording(): Promise<boolean> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.startRecording !== 'function') {
      return false;
    }
    return mod.startRecording();
  }

  public async stopRecording(): Promise<NativeAudioRecordingResult | null> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.stopRecording !== 'function') {
      return null;
    }
    return mod.stopRecording();
  }

  public async cancelRecording(): Promise<void> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.cancelRecording !== 'function') {
      return;
    }
    return mod.cancelRecording();
  }

  public async startRollingRecording(options?: { maxDurationMs?: number }): Promise<boolean> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.startRollingRecording !== 'function') {
      return false;
    }
    return mod.startRollingRecording(options ?? {});
  }

  public async stopRollingRecording(): Promise<NativeRollingRecordingResult | null> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.stopRollingRecording !== 'function') {
      return null;
    }
    return mod.stopRollingRecording();
  }

  public async cancelRollingRecording(): Promise<void> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.cancelRollingRecording !== 'function') {
      return;
    }
    return mod.cancelRollingRecording();
  }

  public async transcribeAudio(
    filePath: string,
    language?: 'en' | 'hi',
    modelPath?: string
  ): Promise<NativeAudioTranscriptionResult | null> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.transcribeAudio !== 'function') {
      return null;
    }
    return mod.transcribeAudio(filePath, language ?? 'en', modelPath ?? '');
  }

  public async downloadFile(url: string, targetPath: string): Promise<boolean> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.downloadFile !== 'function') {
      return false;
    }
    return mod.downloadFile(url, targetPath);
  }

  public async verifyFileChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.verifyFileChecksum !== 'function') {
      return false;
    }
    return mod.verifyFileChecksum(filePath, expectedSha256);
  }

  public async moveFile(sourcePath: string, targetPath: string): Promise<boolean> {
    const mod = this.nativeModule;
    if (!mod || typeof mod.moveFile !== 'function') {
      return false;
    }
    return mod.moveFile(sourcePath, targetPath);
  }

  public addMeteringListener(listener: (event: NativeAudioMeteringEvent) => void): () => void {
    const emitter = this.getEventEmitter();
    if (!emitter) {
      return () => {};
    }
    const subscription = emitter.addListener('onAudioMetering', listener);
    return () => {
      subscription.remove();
    };
  }

  public addChunkReadyListener(listener: (event: ChunkReadyEvent) => void): () => void {
    const emitter = this.getEventEmitter();
    if (!emitter) {
      return () => {};
    }
    const subscription = emitter.addListener('onChunkReady', listener);
    return () => {
      subscription.remove();
    };
  }

  public addCeilingListener(listener: () => void): () => void {
    const emitter = this.getEventEmitter();
    if (!emitter) {
      return () => {};
    }
    const subscription = emitter.addListener('onCeilingReached', listener);
    return () => {
      subscription.remove();
    };
  }
}

export const nativeAudio = new NativeAudioBridge();

