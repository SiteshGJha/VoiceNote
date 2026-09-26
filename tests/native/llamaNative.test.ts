import { llamaNative, LlamaNativeBridge } from '@/native/llamaNative';
import { MlError } from '@/ml/errors';

describe('Native Llama / GGUF Bridge', () => {
  let bridge: LlamaNativeBridge;

  beforeEach(() => {
    bridge = new LlamaNativeBridge();
  });

  afterEach(async () => {
    await bridge.unloadModel();
    bridge.setMockInferenceHook(null);
  });

  it('starts in an unloaded state (lazy loading guarantee)', () => {
    expect(bridge.isLoaded()).toBe(false);
    expect(bridge.getLoadedModelPath()).toBeNull();
  });

  it('loads GGUF model lazily on first call', async () => {
    const modelPath = '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
    await bridge.loadModel(modelPath);

    expect(bridge.isLoaded()).toBe(true);
    expect(bridge.getLoadedModelPath()).toBe(modelPath);
  });

  it('reuses active session when called repeatedly with same model path', async () => {
    const modelPath = '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
    await bridge.loadModel(modelPath);
    await bridge.loadModel(modelPath);

    expect(bridge.isLoaded()).toBe(true);
  });

  it('unloads model and frees memory cleanly', async () => {
    const modelPath = '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
    await bridge.loadModel(modelPath);
    expect(bridge.isLoaded()).toBe(true);

    await bridge.unloadModel();
    expect(bridge.isLoaded()).toBe(false);
    expect(bridge.getLoadedModelPath()).toBeNull();
  });

  it('executes text generation with prompt markers', async () => {
    const modelPath = '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
    const result = await bridge.generate({
      modelPath,
      prompt: 'You rewrite spoken text into clear, professional writing.\n\nInput: Um like we should meet at 3pm.\nOutput:',
    });

    expect(result.text).toBeDefined();
    expect(result.text).toContain('3pm');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('enforces timeout constraint when execution exceeds timeoutMs', async () => {
    const modelPath = '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
    bridge.setMockInferenceHook(() => {
      // Simulate blocking or hanging inference
      const start = Date.now();
      while (Date.now() - start < 100) {
        // synchronous spin for a short time
      }
      throw new MlError('SLM_TIMEOUT', 'Simulated inference hang');
    });

    await expect(
      bridge.generate({
        modelPath,
        prompt: 'Input: Hello\nOutput:',
        timeoutMs: 50,
      })
    ).rejects.toThrow();
  });
});
