import { whisperNative } from '@/native/whisperNative';
import { MlError } from '@/ml/errors';

describe('WhisperNativeBridge', () => {
  afterEach(async () => {
    await whisperNative.unloadModel();
    whisperNative.setMockInferenceHook(null);
  });

  it('loads model off-thread and caches loaded session', async () => {
    expect(whisperNative.isLoaded()).toBe(false);
    await whisperNative.loadModel('/mock/path/whisper-base.bin');

    expect(whisperNative.isLoaded()).toBe(true);
    expect(whisperNative.getLoadedModelPath()).toBe('/mock/path/whisper-base.bin');

    // Calling again with same path should reuse cached session
    await whisperNative.loadModel('/mock/path/whisper-base.bin');
    expect(whisperNative.isLoaded()).toBe(true);
  });

  it('unloads model cleanly on demand', async () => {
    await whisperNative.loadModel('/mock/path/whisper-base.bin');
    expect(whisperNative.isLoaded()).toBe(true);

    await whisperNative.unloadModel();
    expect(whisperNative.isLoaded()).toBe(false);
    expect(whisperNative.getLoadedModelPath()).toBeNull();
  });

  it('throws error when target audio file does not exist on disk', async () => {
    await expect(
      whisperNative.transcribe({
        audioUri: '/non/existent/path/audio.wav',
        modelPath: '/mock/path/whisper-base.bin',
      })
    ).rejects.toThrow(/Audio file does not exist/);
  });

  test('transcribing empty audio URI returns ASR_EMPTY_OUTPUT', async () => {
    await expect(
      whisperNative.transcribe({
        audioUri: '/mock/empty.wav',
        modelPath: '/mock/model.bin',
      })
    ).rejects.toMatchObject({ code: 'ASR_EMPTY_OUTPUT' });
  });

  it('enforces timeout guard when inference exceeds timeoutMs', async () => {
    whisperNative.setMockInferenceHook(() => {
      // Simulate hanging inference
      const neverResolving = new Promise<never>(() => {});
      return neverResolving as unknown as { text: string; detectedLang: 'en'; durationMs: number };
    });

    try {
      await whisperNative.transcribe({
        audioUri: '/mock/test.wav',
        modelPath: '/mock/path/whisper-base.bin',
        timeoutMs: 50, // fast timeout for test
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(MlError);
      if (err instanceof MlError) {
        expect(err.code).toBe('ASR_TIMEOUT');
      }
    }
  });

  it('delegates to nativeAudio.transcribeAudio when nativeAudio is available', async () => {
    const { nativeAudio } = require('@/native/nativeAudio');
    const origAvailable = nativeAudio.isNativeAvailable;
    const origTranscribe = nativeAudio.transcribeAudio;

    try {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: true, configurable: true });
      nativeAudio.transcribeAudio = jest.fn().mockResolvedValue({
        text: 'Transcribed from native speech engine',
        detectedLang: 'en',
        durationMs: 120,
      });

      const res = await whisperNative.transcribe({
        audioUri: '/mock/speech.wav',
        modelPath: '/mock/model.bin',
        language: 'en',
      });

      expect(res.text).toBe('Transcribed from native speech engine');
      expect(res.detectedLang).toBe('en');
      expect(nativeAudio.transcribeAudio).toHaveBeenCalledWith('/mock/speech.wav', 'en');
    } finally {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: origAvailable, configurable: true });
      nativeAudio.transcribeAudio = origTranscribe;
    }
  });
});
