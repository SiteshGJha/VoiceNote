import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { logger } from '@/utils/logger';

export interface NativeAudioRecordingResult {
  uri: string;
  durationMs: number;
  byteLength: number;
  hasSpeech: boolean;
  sampleRate: number;
  channels: number;
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

const { VoiceNoteNativeAudio } = NativeModules;

export class NativeAudioBridge {
  private eventEmitter: NativeEventEmitter | null = null;
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = !!(VoiceNoteNativeAudio && typeof VoiceNoteNativeAudio.startRecording === 'function');
    if (this.isAvailable) {
      try {
        this.eventEmitter = new NativeEventEmitter(VoiceNoteNativeAudio);
      } catch (err) {
        logger.warn('NativeAudio', 'Failed to initialize NativeEventEmitter for VoiceNoteNativeAudio', err);
      }
    }
  }

  public get isNativeAvailable(): boolean {
    return this.isAvailable;
  }

  public async startRecording(): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }
    return VoiceNoteNativeAudio.startRecording();
  }

  public async stopRecording(): Promise<NativeAudioRecordingResult | null> {
    if (!this.isAvailable) {
      return null;
    }
    return VoiceNoteNativeAudio.stopRecording();
  }

  public async cancelRecording(): Promise<void> {
    if (!this.isAvailable) {
      return;
    }
    return VoiceNoteNativeAudio.cancelRecording();
  }

  public async transcribeAudio(filePath: string, language?: 'en' | 'hi'): Promise<NativeAudioTranscriptionResult | null> {
    if (!this.isAvailable || typeof VoiceNoteNativeAudio.transcribeAudio !== 'function') {
      return null;
    }
    return VoiceNoteNativeAudio.transcribeAudio(filePath, language ?? 'en');
  }

  public addMeteringListener(listener: (event: NativeAudioMeteringEvent) => void): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }
    const subscription = this.eventEmitter.addListener('onAudioMetering', listener);
    return () => {
      subscription.remove();
    };
  }
}

export const nativeAudio = new NativeAudioBridge();
