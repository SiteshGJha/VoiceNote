import { BackgroundAudioWorker } from '@/native/audioWorker';

describe('BackgroundAudioWorker', () => {
  it('starts and stops background capture gracefully', async () => {
    const worker = new BackgroundAudioWorker({ sampleRate: 16000, frameMs: 30, channels: 1 });
    expect(worker.isRunning()).toBe(false);

    await worker.startCapture();
    expect(worker.isRunning()).toBe(true);

    // Starting again when already running should be a no-op
    await worker.startCapture();
    expect(worker.isRunning()).toBe(true);

    await worker.stopCapture();
    expect(worker.isRunning()).toBe(false);
  });

  it('dispatches PCM frames and metering data to registered listeners', async () => {
    const worker = new BackgroundAudioWorker({ sampleRate: 16000, frameMs: 30, channels: 1 });
    await worker.startCapture();

    let receivedBytes = 0;
    let receivedAmplitude = 0;

    const unsubscribe = worker.addListener((chunk, metering) => {
      receivedBytes += chunk.length;
      receivedAmplitude = metering.amplitude;
    });

    // Create a 960-byte frame (30ms @ 16kHz 16-bit mono)
    const testFrame = new Uint8Array(960);
    const view = new DataView(testFrame.buffer);
    for (let i = 0; i < 480; i++) {
      view.setInt16(i * 2, 4000, true);
    }

    worker.dispatchFrame(testFrame);

    expect(receivedBytes).toBe(960);
    expect(receivedAmplitude).toBeGreaterThan(0.4);

    unsubscribe();
    worker.dispatchFrame(testFrame);
    // After unsubscribe, receivedBytes should not increase
    expect(receivedBytes).toBe(960);

    await worker.stopCapture();
  });

  it('rejects capture simulation in production release builds', async () => {
    const originalEnv = process.env.NODE_ENV;
    const globalAny = globalThis as Record<string, unknown>;
    const originalDev = globalAny.__DEV__;

    try {
      process.env.NODE_ENV = 'production';
      globalAny.__DEV__ = false;

      const worker = new BackgroundAudioWorker({ sampleRate: 16000, frameMs: 30, channels: 1 });
      await expect(worker.startCapture()).rejects.toThrow(
        'AudioWorker simulation is not permitted in production release builds. Use native audio capture.'
      );
      expect(worker.isRunning()).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalDev === undefined) {
        delete globalAny.__DEV__;
      } else {
        globalAny.__DEV__ = originalDev;
      }
    }
  });
});
