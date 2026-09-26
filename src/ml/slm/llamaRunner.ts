import { llamaNative } from '@/native/llamaNative';
import { SLM_PARAMS } from './promptBuilder';

export interface LlamaParams {
  prompt: string;
  modelPath?: string | undefined;
  timeoutMs?: number | undefined;
  temperature?: number | undefined;
  topP?: number | undefined;
  maxTokens?: number | undefined;
}

/**
 * Off-thread Small Language Model runner (llama.rn / GGUF).
 * Delegates to native Llama bridge with 10s timeout protection and 60s idle auto-unloading.
 */
export async function runLlamaInference(params: LlamaParams): Promise<string> {
  const modelPath = params.modelPath ?? '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';
  const result = await llamaNative.generate({
    modelPath,
    prompt: params.prompt,
    temperature: params.temperature ?? SLM_PARAMS.temperature,
    topP: params.topP ?? SLM_PARAMS.topP,
    maxTokens: params.maxTokens ?? SLM_PARAMS.maxTokens,
    stopSequences: SLM_PARAMS.stop,
    timeoutMs: params.timeoutMs,
  });

  return result.text;
}
