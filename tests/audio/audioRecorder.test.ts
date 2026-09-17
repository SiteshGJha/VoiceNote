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
});
