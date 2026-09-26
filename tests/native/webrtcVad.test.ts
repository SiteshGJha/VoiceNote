import { webrtcVad, SENSITIVITY_TO_WEBRTC_MODE } from '@/native/webrtcVad';

function createSineFrame(amplitude: number): Uint8Array {
  const frame = new Uint8Array(960);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < 480; i++) {
    const val = Math.floor(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000));
    view.setInt16(i * 2, val, true);
  }
  return frame;
}

describe('WebRtcVad Native Adapter', () => {
  it('maps sensitivity presets to appropriate WebRTC modes', () => {
    expect(SENSITIVITY_TO_WEBRTC_MODE.low).toBe(1);
    expect(SENSITIVITY_TO_WEBRTC_MODE.medium).toBe(2);
    expect(SENSITIVITY_TO_WEBRTC_MODE.high).toBe(3);
  });

  it('correctly classifies silent frames as non-speech', () => {
    const silentFrame = new Uint8Array(960);
    const lowResult = webrtcVad.evaluateFrame(silentFrame, 'low');
    const medResult = webrtcVad.evaluateFrame(silentFrame, 'medium');
    const highResult = webrtcVad.evaluateFrame(silentFrame, 'high');

    expect(lowResult.isSpeech).toBe(false);
    expect(medResult.isSpeech).toBe(false);
    expect(highResult.isSpeech).toBe(false);
  });

  it('correctly classifies high energy frames as speech', () => {
    const loudFrame = createSineFrame(16000);
    const result = webrtcVad.evaluateFrame(loudFrame, 'medium');

    expect(result.isSpeech).toBe(true);
    expect(result.probability).toBeGreaterThan(0.5);
  });
});
