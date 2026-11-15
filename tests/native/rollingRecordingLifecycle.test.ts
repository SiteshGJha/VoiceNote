import { audioRecorder } from '@/audio/recorder';
import { nativeAudio } from '@/native/nativeAudio';

describe('Rolling Recording Lifecycle Integration', () => {
  afterEach(async () => {
    try {
      if (audioRecorder.getState() === 'recording') {
        await audioRecorder.cancel();
      }
    } catch {}
  });

  it('audioRecorder.start() and stop() properly coordinate with native rolling recording when native is available', async () => {
    const origAvailable = nativeAudio.isNativeAvailable;
    const startRollingSpy = jest.fn().mockResolvedValue(true);
    const stopRollingSpy = jest.fn().mockResolvedValue({
      sessionId: 'session_test_123',
      totalDurationMs: 5000,
      trailingChunk: {
        uri: '/mock/trailing.wav',
        durationMs: 5000,
        index: 0,
      },
    });

    try {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: true, configurable: true });
      (nativeAudio as any).startRollingRecording = startRollingSpy;
      (nativeAudio as any).stopRollingRecording = stopRollingSpy;

      await audioRecorder.start();
      expect(startRollingSpy).toHaveBeenCalled();

      const result = await audioRecorder.stop();
      expect(stopRollingSpy).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.durationMs).toBe(5000);
      expect((result as any)?.trailingChunk?.uri).toBe('/mock/trailing.wav');
    } finally {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: origAvailable, configurable: true });
    }
  });

  it('audioRecorder.cancel() invokes nativeAudio.cancelRollingRecording when native is available', async () => {
    const origAvailable = nativeAudio.isNativeAvailable;
    const cancelRollingSpy = jest.fn().mockResolvedValue(undefined);

    try {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: true, configurable: true });
      (nativeAudio as any).startRollingRecording = jest.fn().mockResolvedValue(true);
      (nativeAudio as any).cancelRollingRecording = cancelRollingSpy;

      await audioRecorder.start();
      await audioRecorder.cancel();
      expect(cancelRollingSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: origAvailable, configurable: true });
    }
  });

  it('audioRecorder.stop() handles empty trailing chunk gracefully if overall session duration > 500ms', async () => {
    const origAvailable = nativeAudio.isNativeAvailable;
    const startRollingSpy = jest.fn().mockResolvedValue(true);
    const stopRollingSpy = jest.fn().mockResolvedValue({
      sessionId: 'session_long_123',
      totalDurationMs: 45000,
      trailingChunk: null,
    });

    try {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: true, configurable: true });
      (nativeAudio as any).startRollingRecording = startRollingSpy;
      (nativeAudio as any).stopRollingRecording = stopRollingSpy;

      await audioRecorder.start();
      const result = await audioRecorder.stop();
      expect(result).not.toBeNull();
      expect(result?.durationMs).toBe(45000);
      expect(result?.hasSpeech).toBe(true);
      expect(result?.trailingChunk).toBeNull();
    } finally {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: origAvailable, configurable: true });
    }
  });
});
