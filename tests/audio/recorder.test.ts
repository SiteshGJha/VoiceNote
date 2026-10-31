import * as fs from 'fs';
import { audioRecorder } from '@/audio/recorder';
import { getRustCore } from '@/native/rustCore';

describe('AudioRecorder -> Rust Core Bridge', () => {
  afterEach(async () => {
    if (audioRecorder.getState() === 'recording') {
      await audioRecorder.cancel();
    }
  });

  test('stop() produces valid trimmed WAV file via Rust pipeline', async () => {
    await audioRecorder.start();
    const frame = new Uint8Array(960);
    // Push non-silent frame
    frame[0] = 50;
    frame[1] = 50;
    audioRecorder.pushFrame(frame);
    const result = await audioRecorder.stop();
    expect(result).not.toBeNull();
    expect(result!.uri).toMatch(/\.wav$/);

    // Verify temp file exists and has WAV header
    expect(fs.existsSync(result!.uri)).toBe(true);
    const header = fs.readFileSync(result!.uri, { flag: 'r' }).subarray(0, 4).toString('ascii');
    expect(header).toBe('RIFF');

    // Clean up temporary audio (audio ephemerality prime directive)
    await audioRecorder.cleanupTempFile(result!.uri);
    expect(fs.existsSync(result!.uri)).toBe(false);
  });

  test('stop() delegates WAV trimming and encoding to getRustCore().trimAndSaveWav', async () => {
    const rustCore = getRustCore();
    expect(rustCore).not.toBeNull();
    const spy = jest.spyOn(rustCore!, 'trimAndSaveWav');

    await audioRecorder.start();
    const frame = new Uint8Array(960);
    frame[0] = 50;
    frame[1] = 50;
    audioRecorder.pushFrame(frame);

    const result = await audioRecorder.stop();
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [pcmArg, pathArg, paddingArg] = firstCall!;
    expect(pcmArg).toBeInstanceOf(ArrayBuffer);
    expect(typeof pathArg).toBe('string');
    expect(pathArg).toMatch(/\.wav$/);
    expect(paddingArg).toBe(200);

    if (result?.uri && fs.existsSync(result.uri)) {
      await audioRecorder.cleanupTempFile(result.uri);
    }
    spy.mockRestore();
  });
});
