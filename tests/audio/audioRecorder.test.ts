import * as fs from 'fs';
import { audioRecorder } from '@/audio/recorder';

function createSpeechFrame(level: number): Uint8Array {
  const frame = new Uint8Array(960);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < 480; i++) {
    view.setInt16(i * 2, level, true);
  }
  return frame;
}

describe('AudioRecorderService', () => {
  afterEach(async () => {
    if (audioRecorder.getState() === 'recording') {
      await audioRecorder.cancel();
    }
  });

  it('records speech frames and outputs trimmed WAV file', async () => {
    await audioRecorder.start();
    expect(audioRecorder.getState()).toBe('recording');

    // Push 5 silent frames, 10 speech frames, 5 silent frames
    const silentFrame = createSpeechFrame(0);
    const speechFrame = createSpeechFrame(6000);

    for (let i = 0; i < 5; i++) audioRecorder.pushFrame(silentFrame);
    for (let i = 0; i < 10; i++) audioRecorder.pushFrame(speechFrame);
    for (let i = 0; i < 5; i++) audioRecorder.pushFrame(silentFrame);

    const result = await audioRecorder.stop();
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.hasSpeech).toBe(true);
    expect(result.uri).toBeTruthy();
    expect(fs.existsSync(result.uri)).toBe(true);

    // Verify WAV file header
    const fileBytes = fs.readFileSync(result.uri);
    expect(fileBytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(fileBytes.toString('ascii', 8, 12)).toBe('WAVE');

    // Clean up temporary audio
    await audioRecorder.cleanupTempFile(result.uri);
    expect(fs.existsSync(result.uri)).toBe(false);
  });

  it('flags hasSpeech as false when input audio is purely silent', async () => {
    await audioRecorder.start();
    const silentFrame = createSpeechFrame(0);
    for (let i = 0; i < 10; i++) {
      audioRecorder.pushFrame(silentFrame);
    }

    const result = await audioRecorder.stop();
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.hasSpeech).toBe(false);

    if (result.uri && fs.existsSync(result.uri)) {
      await audioRecorder.cleanupTempFile(result.uri);
    }
  });

  it('cancels active recording and discards buffers', async () => {
    await audioRecorder.start();
    audioRecorder.pushFrame(createSpeechFrame(5000));
    await audioRecorder.cancel();

    expect(audioRecorder.getState()).toBe('idle');
  });

  it('prepends pre-roll audio frames captured prior to explicit start', async () => {
    // While idle, push frames (simulate background mic buffer / early speech)
    const preRollSpeech = createSpeechFrame(4000);
    for (let i = 0; i < 15; i++) {
      audioRecorder.pushFrame(preRollSpeech);
    }

    await audioRecorder.start();

    // Push active recording frames
    for (let i = 0; i < 5; i++) {
      audioRecorder.pushFrame(preRollSpeech);
    }

    const result = await audioRecorder.stop();
    expect(result).not.toBeNull();
    if (!result) return;

    // 5 active frames = 4800 bytes. With pre-roll (up to ~400ms = ~13 frames = 12480 bytes),
    // total raw byte length before WAV header (44 bytes) must be >= 10 frames (9600 bytes)
    expect(result.byteLength).toBeGreaterThanOrEqual(9600 + 44);
    expect(result.hasSpeech).toBe(true);

    if (result.uri && fs.existsSync(result.uri)) {
      await audioRecorder.cleanupTempFile(result.uri);
    }
  });

  it('applies tail hangover delay before finalizing stop', async () => {
    await audioRecorder.start();
    const speech = createSpeechFrame(5000);
    audioRecorder.pushFrame(speech);

    const stopPromise = audioRecorder.stop();
    // During the hangover window, additional speech frame arrives
    audioRecorder.pushFrame(speech);

    const result = await stopPromise;
    expect(result).not.toBeNull();
    if (!result) return;

    // Both the initial frame and the frame during hangover window must be included
    expect(result.byteLength).toBeGreaterThanOrEqual(2 * 960 + 44);

    if (result.uri && fs.existsSync(result.uri)) {
      await audioRecorder.cleanupTempFile(result.uri);
    }
  });
});
