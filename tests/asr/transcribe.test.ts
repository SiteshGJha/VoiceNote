import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { transcribe } from '@/ml/asr';
import { asrModelRegistry } from '@/ml/asr/modelRegistry';
import { wrapPcmWithWavHeader } from '@/audio/wavUtils';

describe('ASR Transcription Pipeline', () => {
  it('transcribes English audio clip successfully', async () => {
    const result = await transcribe('/mock/cache/audio_en.wav', { lang: 'en' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.text).toBeTruthy();
      expect(result.detectedLang).toBe('en');
      expect(result.durationMs).toBeGreaterThan(0);
    }
  });

  it('transcribes Hindi audio clip in Devanagari by default', async () => {
    const result = await transcribe('/mock/cache/audio_hi.wav', { lang: 'hi' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.detectedLang).toBe('hi');
      // Contains Devanagari characters
      expect(/[\u0900-\u097F]/.test(result.text)).toBe(true);
    }
  });

  it('transcribes Hindi audio clip in Romanized output when requested', async () => {
    const result = await transcribe('/mock/cache/audio_hi.wav', {
      lang: 'hi',
      hindiOutput: 'romanized',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.detectedLang).toBe('hi');
      // Contains Romanized Latin characters
      expect(/[a-zA-Z]/.test(result.text)).toBe(true);
    }
  });

  it('handles Hinglish code-switched audio with bilingual hint', async () => {
    const result = await transcribe('/mock/cache/audio_hinglish.wav', {
      lang: 'auto',
      prompt: 'The speaker may mix Hindi and English.',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.text).toBeTruthy();
    }
  });

  it('applies short-clip heuristic (< 1.5s) in auto mode defaulting to en', async () => {
    // 800ms of audio (800 * 32 bytes = 25600 bytes)
    const shortPcm = new Uint8Array(800 * 32);
    const wavBytes = wrapPcmWithWavHeader(shortPcm);
    const shortWavPath = path.join(os.tmpdir(), `short_test_${Date.now()}.wav`);
    fs.writeFileSync(shortWavPath, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));

    try {
      const result = await transcribe(shortWavPath, { lang: 'auto' });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.detectedLang).toBe('en');
      }
    } finally {
      if (fs.existsSync(shortWavPath)) {
        fs.unlinkSync(shortWavPath);
      }
    }
  });

  it('returns ASR_MODEL_MISSING error when required model is not installed', async () => {
    // Temporarily unregister base model
    asrModelRegistry.unregisterModel('whisper-base-multilingual');
    const result = await transcribe('/mock/cache/audio.wav', { lang: 'en' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('ASR_MODEL_MISSING');
    }

    // Restore registration
    asrModelRegistry.registerInstalledModel('whisper-base-multilingual', '/mock/path/whisper-base.bin');
  });

  it('returns error when audio uri is empty', async () => {
    const result = await transcribe('', { lang: 'en' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('AUDIO_RECORD_FAILED');
    }
  });

  it('returns error when non-mock audio file does not exist', async () => {
    const result = await transcribe('/non/existent/path/file.wav', { lang: 'en' });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('AUDIO_RECORD_FAILED');
    }
  });
});
