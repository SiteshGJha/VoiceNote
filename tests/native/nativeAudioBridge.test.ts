import { NativeModules, NativeEventEmitter } from 'react-native';
import { NativeAudioBridge } from '@/native/nativeAudio';

describe('NativeAudioBridge Unit Tests', () => {
  let mockVoiceNoteNativeAudio: any;

  beforeEach(() => {
    mockVoiceNoteNativeAudio = {
      startRecording: jest.fn().mockResolvedValue(true),
      stopRecording: jest.fn().mockResolvedValue({
        uri: '/tmp/test.wav',
        durationMs: 1500,
        byteLength: 48000,
        hasSpeech: true,
        sampleRate: 16000,
        channels: 1,
      }),
      cancelRecording: jest.fn().mockResolvedValue(undefined),
      startRollingRecording: jest.fn().mockResolvedValue(true),
      stopRollingRecording: jest.fn().mockResolvedValue({
        sessionId: 'session_123',
        totalDurationMs: 5000,
      }),
      cancelRollingRecording: jest.fn().mockResolvedValue(undefined),
      transcribeAudio: jest.fn().mockResolvedValue({
        text: 'Hello world',
        detectedLang: 'en',
        durationMs: 250,
      }),
      downloadFile: jest.fn().mockResolvedValue(true),
      verifyFileChecksum: jest.fn().mockResolvedValue(true),
      moveFile: jest.fn().mockResolvedValue(true),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };

    NativeModules.VoiceNoteNativeAudio = mockVoiceNoteNativeAudio;
  });

  afterEach(() => {
    delete NativeModules.VoiceNoteNativeAudio;
  });

  it('transcribeAudio forwards exactly 3 arguments to native bridge', async () => {
    const bridge = new NativeAudioBridge();
    expect(bridge.isNativeAvailable).toBe(true);

    const result = await bridge.transcribeAudio('/path/to/audio.wav', 'hi', '/path/to/model.gguf');
    expect(result).toEqual({
      text: 'Hello world',
      detectedLang: 'en',
      durationMs: 250,
    });
    expect(mockVoiceNoteNativeAudio.transcribeAudio).toHaveBeenCalledWith(
      '/path/to/audio.wav',
      'hi',
      '/path/to/model.gguf'
    );
  });

  it('transcribeAudio provides default arguments for language and modelPath', async () => {
    const bridge = new NativeAudioBridge();
    await bridge.transcribeAudio('/path/to/audio.wav');
    expect(mockVoiceNoteNativeAudio.transcribeAudio).toHaveBeenCalledWith(
      '/path/to/audio.wav',
      'en',
      ''
    );
  });

  it('transcribeAudio returns null if native module is not available', async () => {
    delete NativeModules.VoiceNoteNativeAudio;
    const bridge = new NativeAudioBridge();
    expect(bridge.isNativeAvailable).toBe(false);

    const result = await bridge.transcribeAudio('/path/to/audio.wav');
    expect(result).toBeNull();
  });

  it('downloadFile, verifyFileChecksum, and moveFile forward to native methods', async () => {
    const bridge = new NativeAudioBridge();

    const downloaded = await bridge.downloadFile('https://example.com/model.gguf', '/local/model.gguf');
    expect(downloaded).toBe(true);
    expect(mockVoiceNoteNativeAudio.downloadFile).toHaveBeenCalledWith(
      'https://example.com/model.gguf',
      '/local/model.gguf'
    );

    const verified = await bridge.verifyFileChecksum('/local/model.gguf', 'abcdef123456');
    expect(verified).toBe(true);
    expect(mockVoiceNoteNativeAudio.verifyFileChecksum).toHaveBeenCalledWith(
      '/local/model.gguf',
      'abcdef123456'
    );

    const moved = await bridge.moveFile('/local/temp.gguf', '/local/final.gguf');
    expect(moved).toBe(true);
    expect(mockVoiceNoteNativeAudio.moveFile).toHaveBeenCalledWith(
      '/local/temp.gguf',
      '/local/final.gguf'
    );
  });
});
