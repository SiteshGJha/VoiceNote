import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { audioRecorder } from '@/audio/recorder';
import { nativeAudio } from '@/native/nativeAudio';
import { audioWorker } from '@/native/audioWorker';

describe('AudioRecorder Rolling Capture & Sanitation', () => {
  it('startup sanitation sweep unlinks orphaned chunk files', async () => {
    const tempDir = os.tmpdir();
    const orphanedChunk1 = path.join(tempDir, `voicenote_chunk_test_orphaned_1.wav`);
    const orphanedChunk2 = path.join(tempDir, `voicenote_chunk_test_orphaned_2.wav`);
    const unrelatedFile = path.join(tempDir, `unrelated_test_file_${Date.now()}.txt`);

    fs.writeFileSync(orphanedChunk1, 'RIFF mock chunk 1');
    fs.writeFileSync(orphanedChunk2, 'RIFF mock chunk 2');
    fs.writeFileSync(unrelatedFile, 'keep me');

    expect(fs.existsSync(orphanedChunk1)).toBe(true);
    expect(fs.existsSync(orphanedChunk2)).toBe(true);
    expect(fs.existsSync(unrelatedFile)).toBe(true);

    // Run startup sweep
    await audioRecorder.init();

    expect(fs.existsSync(orphanedChunk1)).toBe(false);
    expect(fs.existsSync(orphanedChunk2)).toBe(false);
    expect(fs.existsSync(unrelatedFile)).toBe(true);

    // Clean up unrelated file
    try {
      fs.unlinkSync(unrelatedFile);
    } catch {}
  });

  it('native audio bridge handles rolling recording calls gracefully when native is unavailable', async () => {
    const started = await nativeAudio.startRollingRecording({ maxDurationMs: 300000 });
    expect(typeof started).toBe('boolean');

    const stopped = await nativeAudio.stopRollingRecording();
    // In Node test environment, native bridge is not available by default
    if (!nativeAudio.isNativeAvailable) {
      expect(stopped).toBeNull();
    }

    await expect(nativeAudio.cancelRollingRecording()).resolves.toBeUndefined();

    const unsubChunk = nativeAudio.addChunkReadyListener(() => {});
    expect(typeof unsubChunk).toBe('function');
    unsubChunk();

    const unsubCeiling = nativeAudio.addCeilingListener(() => {});
    expect(typeof unsubCeiling).toBe('function');
    unsubCeiling();
  });

  it('audioWorker simulateRollingChunks emits chunks and respects cancel', (done) => {
    const received: any[] = [];
    const cancel = audioWorker.simulateRollingChunks(3, 20, (chunk) => {
      received.push(chunk);
      if (received.length === 2) {
        cancel();
        setTimeout(() => {
          expect(received.length).toBe(2);
          expect(received[0].index).toBe(0);
          expect(received[1].index).toBe(1);
          done();
        }, 60);
      }
    });
  });

  it('cleanupTempFile deletes individual target chunk file', async () => {
    const tempDir = os.tmpdir();
    const chunkFile = path.join(tempDir, `voicenote_chunk_delete_${Date.now()}.wav`);
    fs.writeFileSync(chunkFile, 'RIFF test audio chunk');

    expect(fs.existsSync(chunkFile)).toBe(true);
    await audioRecorder.cleanupTempFile(chunkFile);
    expect(fs.existsSync(chunkFile)).toBe(false);
  });
});
