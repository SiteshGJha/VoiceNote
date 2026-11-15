import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startRollingPipelineSession } from '@/pipeline/orchestrator';
import { whisperNative } from '@/native/whisperNative';
import { historyStorage } from '@/services/history';

describe('Rolling Pipeline Orchestration', () => {
  it('transcribes rolling chunks sequentially with prompt conditioning and deletes audio files', async () => {
    const tempDir = os.tmpdir();
    const chunkFile1 = path.join(tempDir, `voicenote_chunk_test_1_${Date.now()}.wav`);
    const chunkFile2 = path.join(tempDir, `voicenote_chunk_test_2_${Date.now()}.wav`);

    fs.writeFileSync(chunkFile1, 'RIFF mock chunk 1');
    fs.writeFileSync(chunkFile2, 'RIFF mock chunk 2');

    expect(fs.existsSync(chunkFile1)).toBe(true);
    expect(fs.existsSync(chunkFile2)).toBe(true);

    const progressUpdates: any[] = [];
    const session = startRollingPipelineSession(
      {
        tone: 'professional',
        lang: 'en',
      },
      (p) => {
        progressUpdates.push(p);
      }
    );

    session.pushChunk({
      uri: chunkFile1,
      durationMs: 20000,
      index: 0,
    });

    session.pushChunk({
      uri: chunkFile2,
      durationMs: 22000,
      index: 1,
    });

    const result = await session.finalizeSession();

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.raw).toBeTruthy();
      expect(result.final).toBeTruthy();
      expect(result.audioDurationMs).toBe(42000);
      expect(result.asrDurationMs).toBeGreaterThan(0);
    }

    // Prime Directive assertion: chunk files must be unlinked post-ASR!
    expect(fs.existsSync(chunkFile1)).toBe(false);
    expect(fs.existsSync(chunkFile2)).toBe(false);

    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it('recovers from intermediate chunk failure with localized placeholder', async () => {
    const session = startRollingPipelineSession({
      tone: 'professional',
      lang: 'en',
    });

    session.pushChunk({
      uri: '/mock/error.wav', // Trigger ASR failure (non-silence)
      durationMs: 20000,
      index: 0,
    });

    const tempDir = os.tmpdir();
    const validChunk = path.join(tempDir, `voicenote_chunk_valid_${Date.now()}.wav`);
    fs.writeFileSync(validChunk, 'RIFF valid chunk');

    session.pushChunk({
      uri: validChunk,
      durationMs: 21000,
      index: 1,
    });

    const result = await session.finalizeSession();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.raw).toContain('[untranscribed audio: 20s]');
    }

    expect(fs.existsSync(validChunk)).toBe(false);
  });

  it('omits natural silence chunks (ASR_EMPTY_OUTPUT) without inserting placeholder tokens', async () => {
    const session = startRollingPipelineSession({
      tone: 'professional',
      lang: 'en',
    });

    // Chunk 0 is silence / pause (returns ASR_EMPTY_OUTPUT)
    session.pushChunk({
      uri: '/mock/empty.wav',
      durationMs: 3000,
      index: 0,
    });

    // Chunk 1 has speech
    const tempDir = os.tmpdir();
    const validChunk = path.join(tempDir, `voicenote_chunk_speech_${Date.now()}.wav`);
    fs.writeFileSync(validChunk, 'RIFF valid chunk');

    session.pushChunk({
      uri: validChunk,
      durationMs: 5000,
      index: 1,
    });

    const result = await session.finalizeSession();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.raw).not.toContain('[untranscribed audio');
      expect(result.final).not.toContain('[untranscribed audio');
      expect(result.raw.length).toBeGreaterThan(0);
    }

    expect(fs.existsSync(validChunk)).toBe(false);
  });

  it('returns ASR_EMPTY_OUTPUT when rolling session contains only silence', async () => {
    const session = startRollingPipelineSession({
      tone: 'professional',
      lang: 'en',
    });

    // Session only had a 3-second silence chunk
    session.pushChunk({
      uri: '/mock/empty.wav',
      durationMs: 3000,
      index: 0,
    });

    const result = await session.finalizeSession();
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('ASR_EMPTY_OUTPUT');
      expect(result.message).toBe("Didn't catch that — try again");
    }
  });

  it('cancelSession discards queued chunks and unlinks them', async () => {
    const tempDir = os.tmpdir();
    const chunkFile = path.join(tempDir, `voicenote_chunk_cancel_${Date.now()}.wav`);
    fs.writeFileSync(chunkFile, 'RIFF cancel chunk');

    const session = startRollingPipelineSession({
      tone: 'casual',
      lang: 'en',
    });

    session.pushChunk({
      uri: chunkFile,
      durationMs: 20000,
      index: 0,
    });

    await session.cancelSession();

    // Give asynchronous unlinking a moment to run
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(chunkFile)).toBe(false);
  });
});
