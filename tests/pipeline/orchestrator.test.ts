import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executePipeline } from '@/pipeline/orchestrator';
import { RecordedAudio } from '@/audio/types';
import { historyStorage } from '@/services/history';

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
});
