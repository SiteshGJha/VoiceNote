import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executePipeline } from '@/pipeline/orchestrator';
import { RecordedAudio } from '@/audio/types';
import { historyStorage } from '@/services/history';
import { whisperNative } from '@/native/whisperNative';
import Clipboard from '@react-native-clipboard/clipboard';

describe('Pipeline Orchestrator & Audio File Cleanup', () => {
  it('executes full pipeline and strictly deletes temporary audio file post-ASR', async () => {
    // Create temporary audio fixture
    const tempDir = os.tmpdir();
    const tempAudioPath = path.join(tempDir, `test_audio_${Date.now()}.wav`);
    fs.writeFileSync(tempAudioPath, Buffer.from('RIFF....WAVEfmt ....data....'));

    expect(fs.existsSync(tempAudioPath)).toBe(true);

    const mockAudio: RecordedAudio = {
      uri: tempAudioPath,
      durationMs: 3000,
      sampleRate: 16000,
      channels: 1,
      byteLength: 96000,
    };

    const stagesVisited: string[] = [];
    const result = await executePipeline(
      mockAudio,
      {
        tone: 'professional',
        lang: 'en',
      },
      (stage) => {
        stagesVisited.push(stage);
      }
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.raw).toBeTruthy();
      expect(result.final).toBeTruthy();
      expect(result.tone).toBe('professional');
      expect(result.usedFallback).toBe(false);
    }

    expect(stagesVisited).toContain('asr');
    expect(stagesVisited).toContain('slm');
    expect(stagesVisited).toContain('saving');

    // PRIME DIRECTIVE ASSERTION: Audio file must be deleted from filesystem!
    expect(fs.existsSync(tempAudioPath)).toBe(false);

    // Verify history recorded the result
    const history = await historyStorage.listRecords();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.finalText).toBe(result.status === 'ok' ? result.final : '');
  });

  it('result contains asrDurationMs and slmDurationMs when pipeline succeeds', async () => {
    const tempDir = os.tmpdir();
    const tempAudioPath = path.join(tempDir, `test_audio_timing_${Date.now()}.wav`);
    fs.writeFileSync(tempAudioPath, Buffer.from('RIFF....WAVEfmt ....data....'));

    const mockAudio: RecordedAudio = {
      uri: tempAudioPath,
      durationMs: 2000,
      sampleRate: 16000,
      channels: 1,
      byteLength: 64000,
    };

    const result = await executePipeline(mockAudio, {
      tone: 'professional',
      lang: 'en',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(typeof result.asrDurationMs).toBe('number');
      expect(typeof result.slmDurationMs).toBe('number');
      expect(result.asrDurationMs).toBeGreaterThan(0);
      expect(result.slmDurationMs).toBeGreaterThan(0);
    }
  });

  it('result returns slmDurationMs as 0 when rewriting is skipped', async () => {
    const tempDir = os.tmpdir();
    const tempAudioPath = path.join(tempDir, `test_audio_timing_skip_${Date.now()}.wav`);
    fs.writeFileSync(tempAudioPath, Buffer.from('RIFF....WAVEfmt ....data....'));

    const mockAudio: RecordedAudio = {
      uri: tempAudioPath,
      durationMs: 2000,
      sampleRate: 16000,
      channels: 1,
      byteLength: 64000,
    };

    const result = await executePipeline(mockAudio, {
      tone: 'professional',
      lang: 'en',
      skipRewriting: true,
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.asrDurationMs).toBeGreaterThan(0);
      expect(result.slmDurationMs).toBe(0);
    }
  });

  it('supports multi-segment chunked pipeline execution and cleans up all temp segment files', async () => {
    const tempDir = os.tmpdir();
    const f1 = path.join(tempDir, `test_seg_1_${Date.now()}.wav`);
    const f2 = path.join(tempDir, `test_seg_2_${Date.now()}.wav`);
    fs.writeFileSync(f1, Buffer.from('RIFF....WAVEfmt ....data....'));
    fs.writeFileSync(f2, Buffer.from('RIFF....WAVEfmt ....data....'));

    const segmentedInput = {
      segments: [
        { uri: f1, durationMs: 30000, index: 0 },
        { uri: f2, durationMs: 15000, index: 1 },
      ],
      totalDurationMs: 45000,
    };

    const stages: string[] = [];
    const result = await executePipeline(
      segmentedInput as any,
      {
        tone: 'professional',
        lang: 'en',
      },
      (stage) => {
        stages.push(stage);
      }
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.audioDurationMs).toBe(45000);
      expect(typeof result.raw).toBe('string');
      expect(typeof result.final).toBe('string');
    }

    // Both segment temp files must be deleted
    expect(fs.existsSync(f1)).toBe(false);
    expect(fs.existsSync(f2)).toBe(false);
  });

  describe('Sequential Memory & Clipboard Auto-Copy Integration', () => {
    beforeEach(() => {
      (Clipboard as any).__reset();
      jest.spyOn(whisperNative, 'unloadModel');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('unloads Whisper model post-ASR and auto-copies final text to clipboard', async () => {
      const tempDir = os.tmpdir();
      const tempAudioPath = path.join(tempDir, `test_audio_clipboard_${Date.now()}.wav`);
      fs.writeFileSync(tempAudioPath, Buffer.from('RIFF....WAVEfmt ....data....'));

      const mockAudio: RecordedAudio = {
        uri: tempAudioPath,
        durationMs: 2500,
        sampleRate: 16000,
        channels: 1,
        byteLength: 80000,
      };

      const result = await executePipeline(mockAudio, {
        tone: 'professional',
        lang: 'en',
        autoCopy: true,
      });

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        // Sequential memory invariant check: Whisper unload was awaited
        expect(whisperNative.unloadModel).toHaveBeenCalled();

        // Clipboard auto-copy check
        expect(Clipboard.setString).toHaveBeenCalledWith(result.final);
      }
    });

    it('does not auto-copy when autoCopy option is false', async () => {
      const tempDir = os.tmpdir();
      const tempAudioPath = path.join(tempDir, `test_audio_no_copy_${Date.now()}.wav`);
      fs.writeFileSync(tempAudioPath, Buffer.from('RIFF....WAVEfmt ....data....'));

      const mockAudio: RecordedAudio = {
        uri: tempAudioPath,
        durationMs: 2000,
        sampleRate: 16000,
        channels: 1,
        byteLength: 64000,
      };

      const result = await executePipeline(mockAudio, {
        tone: 'professional',
        lang: 'en',
        autoCopy: false,
      });

      expect(result.status).toBe('ok');
      expect(Clipboard.setString).not.toHaveBeenCalled();
    });
  });
});


