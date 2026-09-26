import { rewrite, slmModelRegistry } from '@/ml/slm';
import { llamaNative } from '@/native/llamaNative';

describe('SLM Tone Rewriting Pipeline', () => {
  afterEach(async () => {
    llamaNative.setMockInferenceHook(null);
    await llamaNative.unloadModel();
  });

  it('successfully rewrites spoken text into professional tone', async () => {
    const raw = 'Um like we need to schedule a meeting with Alice at 3pm for $250.';
    const result = await rewrite(raw, 'professional', { lang: 'en' });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.tone).toBe('professional');
      expect(result.usedFallback).toBe(false);
      expect(result.final).toContain('3pm');
      expect(result.final).toContain('Alice');
      expect(result.final).toContain('$250');
      expect(result.final.toLowerCase()).not.toContain('um');
    }
  });

  it('successfully rewrites spoken text into casual tone', async () => {
    const raw = 'Uh we are going to grab dinner with Rahul at 8pm tonight.';
    const result = await rewrite(raw, 'casual', { lang: 'en' });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.tone).toBe('casual');
      expect(result.usedFallback).toBe(false);
      expect(result.final).toContain('Rahul');
      expect(result.final).toContain('8pm');
    }
  });

  it('returns ASR_EMPTY_OUTPUT when input transcript is blank', async () => {
    const result = await rewrite('   ', 'professional', { lang: 'en' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('ASR_EMPTY_OUTPUT');
      expect(result.fallbackText).toBe('');
    }
  });

  it('gracefully falls back to raw transcript when preservation guard detects entity loss', async () => {
    const raw = 'Order 500 units for client AcmeCorp before Friday.';
    // Simulate an SLM hallucination that drops 500 and AcmeCorp
    llamaNative.setMockInferenceHook(() => ({
      text: 'Order some units for the client before Friday.',
      durationMs: 120,
    }));

    const result = await rewrite(raw, 'professional', { lang: 'en' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('SLM_HALLUCINATION_SUSPECTED');
      expect(result.fallbackText).toBe(raw);
    }
  });

  it('gracefully falls back to raw transcript on timeout or inference failure', async () => {
    const raw = 'Review the budget report before tomorrow morning.';
    llamaNative.setMockInferenceHook(() => {
      throw new Error('Native inference runtime crash');
    });

    const result = await rewrite(raw, 'professional', { lang: 'en' });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('SLM_TIMEOUT');
      expect(result.fallbackText).toBe(raw);
    }
  });

  it('resolves active model path from slmModelRegistry', async () => {
    const activeModel = slmModelRegistry.getActiveModel();
    expect(activeModel).toBeDefined();
    expect(activeModel.id).toBe('qwen2.5-0.5b-instruct');
    expect(activeModel.quant).toBe('Q4_K_M');
  });
});
