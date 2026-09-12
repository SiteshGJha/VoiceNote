import { VadGate } from '@/audio/vadGate';
import { trimSilence } from '@/audio/silenceTrim';

function createSpeechFrame(level: number): Uint8Array {
  const frame = new Uint8Array(960);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < 480; i++) {
    view.setInt16(i * 2, level, true);
  }
  return frame;
}

describe('VAD and Silence Trimming', () => {
  it('detects speech and transitions state machine', () => {
    let speechStarted = false;
    let speechEnded = false;

    const gate = new VadGate('medium', {
      onSpeechStart: () => {
        speechStarted = true;
      },
      onSpeechEnd: () => {
        speechEnded = true;
      },
    });

    const activeFrame = createSpeechFrame(5000); // normalized ~0.62 > 0.5 threshold
    const silentFrame = createSpeechFrame(0);

    // Feed 10 speech frames (300ms) to meet minSpeechMs threshold
    for (let i = 0; i < 10; i++) {
      gate.processFrame(activeFrame);
    }

    expect(gate.getState()).toBe('speech');
    expect(speechStarted).toBe(true);
    expect(gate.hasDetectedSpeech()).toBe(true);

    // Feed silent frame
    gate.processFrame(silentFrame);
    expect(gate.getState()).toBe('silence');
    expect(speechEnded).toBe(true);
  });

  it('triggers auto-stop when silence exceeds threshold', () => {
    let autoStopFired = false;
    const gate = new VadGate('high', {
      // high preset silence window is 1000 ms
      onAutoStop: () => {
        autoStopFired = true;
      },
    });

    const activeFrame = createSpeechFrame(5000);
    const silentFrame = createSpeechFrame(0);

    // Feed 10 speech frames (300 ms)
    for (let i = 0; i < 10; i++) {
      gate.processFrame(activeFrame);
    }

    expect(autoStopFired).toBe(false);

    // Feed 35 silent frames (35 * 30ms = 1050 ms > 1000ms threshold)
    for (let i = 0; i < 35; i++) {
      gate.processFrame(silentFrame);
    }

    expect(autoStopFired).toBe(true);
  });

  it('trims leading and trailing silence while preserving speech with padding', () => {
    // 5 frames silence + 5 frames speech + 5 frames silence
    const silentFrame = createSpeechFrame(0);
    const speechFrame = createSpeechFrame(5000);

    const totalFrames = 15;
    const pcm = new Uint8Array(totalFrames * 960);
    let offset = 0;

    for (let i = 0; i < 5; i++) {
      pcm.set(silentFrame, offset);
      offset += 960;
    }
    for (let i = 0; i < 5; i++) {
      pcm.set(speechFrame, offset);
      offset += 960;
    }
    for (let i = 0; i < 5; i++) {
      pcm.set(silentFrame, offset);
      offset += 960;
    }

    const result = trimSilence(pcm, { paddingMs: 50, frameMs: 30 });
    expect(result.hasSpeech).toBe(true);
    expect(result.trimmedPcm.length).toBeLessThan(pcm.length);
    expect(result.trimmedLeadingMs).toBeGreaterThan(0);
    expect(result.trimmedTrailingMs).toBeGreaterThan(0);
  });

  it('returns empty when input is 100% silence', () => {
    const allSilence = new Uint8Array(960 * 10);
    const result = trimSilence(allSilence);
    expect(result.hasSpeech).toBe(false);
    expect(result.trimmedPcm.length).toBe(0);
  });
});
