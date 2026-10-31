import { webrtcVad } from '@/native/webrtcVad';
import { getRustCore, __setRustCoreInstance } from '@/native/rustCore';
import { VadGate } from '@/audio/vadGate';

function createSineFrame(amplitude: number): Uint8Array {
  const frame = new Uint8Array(960);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < 480; i++) {
    const val = Math.floor(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000));
    view.setInt16(i * 2, val, true);
  }
  return frame;
}

function createSpeechFrame(level: number): Uint8Array {
  const frame = new Uint8Array(960);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < 480; i++) {
    view.setInt16(i * 2, level, true);
  }
  return frame;
}

describe('VAD Gate & WebRTC VadAdapter Integration with RustCore', () => {
  const originalRustCore = getRustCore();

  afterEach(() => {
    __setRustCoreInstance(originalRustCore);
  });

  it('routes evaluateFrame() through getRustCore()?.evalVad() when available', () => {
    const mockEvalVad = jest.fn((pcm: ArrayBuffer, sensitivityMode?: number) => {
      return { isSpeech: true, probability: 0.88 };
    });

    __setRustCoreInstance({
      getVersion: () => '0.1.0-mock',
      trimAndSaveWav: () => ({ hasSpeech: true, status: 1 }),
      evalVad: mockEvalVad,
    });

    const frame = createSpeechFrame(5000);
    const result = webrtcVad.evaluateFrame(frame, 'medium');

    expect(mockEvalVad).toHaveBeenCalledTimes(1);
    expect(mockEvalVad).toHaveBeenCalledWith(expect.any(ArrayBuffer), 2);
    expect(result).toEqual({
      isSpeech: true,
      probability: 0.88,
    });
  });

  it('maps sensitivity presets to correct sensitivityMode numbers in getRustCore()?.evalVad()', () => {
    const mockEvalVad = jest.fn((pcm: ArrayBuffer, sensitivityMode?: number) => ({
      isSpeech: false,
      probability: 0.1,
    }));

    __setRustCoreInstance({
      getVersion: () => '0.1.0-mock',
      trimAndSaveWav: () => ({ hasSpeech: true, status: 1 }),
      evalVad: mockEvalVad,
    });

    const frame = createSpeechFrame(0);
    webrtcVad.evaluateFrame(frame, 'low');
    expect(mockEvalVad).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), 1);

    webrtcVad.evaluateFrame(frame, 'medium');
    expect(mockEvalVad).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), 2);

    webrtcVad.evaluateFrame(frame, 'high');
    expect(mockEvalVad).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), 3);
  });

  it('falls back cleanly to energy-based RMS when getRustCore() is null', () => {
    __setRustCoreInstance(null);

    const silentFrame = createSpeechFrame(0);
    const silentResult = webrtcVad.evaluateFrame(silentFrame, 'medium');
    expect(silentResult.isSpeech).toBe(false);
    expect(silentResult.probability).toBe(0);

    const loudFrame = createSineFrame(16000);
    const loudResult = webrtcVad.evaluateFrame(loudFrame, 'medium');
    expect(loudResult.isSpeech).toBe(true);
    expect(loudResult.probability).toBeGreaterThan(0.5);
  });

  it('VadGate state machine consumes evaluateFrame probabilities and detects speech', () => {
    let speechStarted = false;
    let speechEnded = false;
    let autoStopped = false;

    const gate = new VadGate('medium', {
      onSpeechStart: () => {
        speechStarted = true;
      },
      onSpeechEnd: () => {
        speechEnded = true;
      },
      onAutoStop: () => {
        autoStopped = true;
      },
    });

    const activeFrame = createSpeechFrame(5000);
    const silentFrame = createSpeechFrame(0);

    // 10 active frames (300 ms)
    for (let i = 0; i < 10; i++) {
      gate.processFrame(activeFrame);
    }

    expect(gate.getState()).toBe('speech');
    expect(gate.hasDetectedSpeech()).toBe(true);
    expect(speechStarted).toBe(true);

    // Silent frame transitions to silence
    gate.processFrame(silentFrame);
    expect(gate.getState()).toBe('silence');
    expect(speechEnded).toBe(true);

    // Feed remaining silence frames to reach medium silenceWindowMs (1500 ms = 50 frames @ 30ms)
    for (let i = 0; i < 55; i++) {
      gate.processFrame(silentFrame);
    }

    expect(autoStopped).toBe(true);
    expect(gate.hasAutoStopped()).toBe(true);
  });
});
