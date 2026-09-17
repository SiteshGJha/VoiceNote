import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { debugVadFile, generateVadHtmlReport, VadFileDebugResult } from '@/../scripts/vad-debug';

describe('VAD Debug and HTML Report Generation', () => {
  const tempHtml = path.join(os.tmpdir(), `test_vad_${Date.now()}.html`);

  afterEach(() => {
    if (fs.existsSync(tempHtml)) {
      fs.unlinkSync(tempHtml);
    }
  });

  it('runs debugVadFile and generates valid SVG HTML report', () => {
    const result = debugVadFile('synthetic_test.wav', 'medium', tempHtml);

    expect(result.totalFrames).toBeGreaterThan(0);
    expect(result.speechFrames).toBeGreaterThan(0);
    expect(result.silenceFrames).toBeGreaterThan(0);
    expect(result.preset).toBe('medium');

    expect(fs.existsSync(tempHtml)).toBe(true);
    const content = fs.readFileSync(tempHtml, 'utf8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Voice Activity Detection Analysis');
    expect(content).toContain('<svg');
    expect(content).toContain('Speech Probability');
  });

  it('generates HTML report with auto-stop marker when autoStopTriggered is true', () => {
    const mockResult: VadFileDebugResult = {
      filePath: 'test.wav',
      preset: 'high',
      totalFrames: 50,
      speechFrames: 10,
      silenceFrames: 40,
      autoStopTriggered: true,
      autoStopFrameIndex: 35,
      totalDurationMs: 1500,
      speechDurationMs: 300,
      silenceDurationMs: 1200,
      frames: [
        { frameIndex: 0, timeMs: 0, probability: 0.1, isSpeech: false, state: 'idle' },
        { frameIndex: 1, timeMs: 30, probability: 0.8, isSpeech: true, state: 'speech' },
        { frameIndex: 35, timeMs: 1050, probability: 0.05, isSpeech: false, state: 'silence' },
      ],
    };

    generateVadHtmlReport(mockResult, tempHtml);
    expect(fs.existsSync(tempHtml)).toBe(true);
    const content = fs.readFileSync(tempHtml, 'utf8');
    expect(content).toContain('Auto-Stop');
    expect(content).toContain('HIGH');
  });
});
