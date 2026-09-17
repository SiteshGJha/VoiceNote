import { computeWer, computeCer, runWerEvaluation } from '@/../scripts/wer';
import { evaluateModelPerformance, runSlmBakeOff } from '@/../scripts/slm-bakeoff';
import { simulateVadFrames } from '@/../scripts/vad-debug';

describe('Benchmark Scripts Harness', () => {
  describe('WER and CER Evaluator', () => {
    it('calculates 0% WER for identical strings', () => {
      const wer = computeWer('the quick brown fox', 'the quick brown fox');
      expect(wer).toBe(0);
    });

    it('calculates expected non-zero WER for substitutions and deletions', () => {
      const wer = computeWer('the quick brown fox', 'the fast brown');
      expect(wer).toBeGreaterThan(0);
      expect(wer).toBeLessThanOrEqual(1);
    });

    it('calculates Character Error Rate (CER) for Devanagari Hindi', () => {
      const cer = computeCer('नमस्ते भारत', 'नमस्ते भारत');
      expect(cer).toBe(0);
    });

    it('runs batch WER evaluation across multiple languages', () => {
      const batch = runWerEvaluation([
        { id: '1', reference: 'hello world', hypothesis: 'hello world', lang: 'en' },
        { id: '2', reference: 'आज मौसम अच्छा है', hypothesis: 'आज मौसम अच्छा है', lang: 'hi' },
      ]);
      expect(batch.overallWer).toBe(0);
      expect(batch.totalSamples).toBe(2);
    });
  });

  describe('SLM Bake-off Evaluator', () => {
    it('evaluates model preservation pass rate and tokens per second', () => {
      const result = evaluateModelPerformance('qwen2.5-0.5b-instruct', [
        {
          raw: 'Pay $400 to Rahul by March 15.',
          generated: 'Please pay $400 to Rahul by March 15.',
          elapsedMs: 250,
          tokenCount: 10,
        },
      ]);
      expect(result.modelId).toBe('qwen2.5-0.5b-instruct');
      expect(result.preservationPassRate).toBe(1);
      expect(result.tokensPerSec).toBeGreaterThan(0);
      expect(result.peakRamMb).toBeLessThanOrEqual(500); // within 500MB budget
    });

    it('runs full bake-off evaluation across candidate models and fixtures', async () => {
      const results = await runSlmBakeOff(['qwen2.5-0.5b-instruct', 'palmer-005']);
      expect(results).toHaveLength(2);
      expect(results[0]?.modelId).toBe('qwen2.5-0.5b-instruct');
      expect(results[1]?.modelId).toBe('palmer-005');
      expect(results[0]?.preservationPassRate).toBeGreaterThanOrEqual(0.8);
      expect(results[0]?.peakRamMb).toBeLessThanOrEqual(500);
    });
  });

  describe('VAD Debug Simulator', () => {
    it('simulates frames and triggers auto-stop when silence window exceeded', () => {
      // 10 speech frames (energy 0.6) followed by 35 silent frames (energy 0.0)
      const energies = [...new Array(10).fill(0.6), ...new Array(35).fill(0.0)];
      const sim = simulateVadFrames(energies, 'high');

      expect(sim.speechFrames).toBe(10);
      expect(sim.silenceFrames).toBe(35);
      expect(sim.autoStopTriggered).toBe(true);
      expect(sim.autoStopFrameIndex).not.toBeNull();
    });
  });
});
