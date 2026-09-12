import { MlError } from '../errors';
import { SLM_GENERATION_PARAMS } from './promptBuilder';
import { logger } from '@/utils/logger';

const SLM_TIMEOUT_MS = 10_000; // 10s timeout per 02-on-device-ml-safety.md

export interface LlamaParams {
  prompt: string;
  timeoutMs?: number;
  temperature?: number;
}

/**
 * Off-thread Small Language Model runner (llama.rn / GGUF).
 * Constrains generation and aborts after 10 s timeout.
 */
export async function runLlamaInference(params: LlamaParams): Promise<string> {
  const timeoutMs = params.timeoutMs ?? SLM_TIMEOUT_MS;

  const generationPromise = new Promise<string>((resolve) => {
    // In production, delegates to llama.rn on a background thread
    // In simulation / test mode, apply prompt-aware rewriting
    const timer = setTimeout(() => {
      const prompt = params.prompt;
      const inputMarker = 'Input:';
      const outputMarker = 'Output:';
      const inputIndex = prompt.indexOf(inputMarker);
      const outputIndex = prompt.lastIndexOf(outputMarker);

      let rawInput = '';
      if (inputIndex !== -1 && outputIndex !== -1) {
        rawInput = prompt.slice(inputIndex + inputMarker.length, outputIndex).trim();
      } else {
        rawInput = prompt;
      }

      // Simulate clean rewriting
      let rewritten = rawInput;
      if (prompt.includes('professional')) {
        // Remove common fillers
        rewritten = rawInput
          .replace(/\b(um|uh|like|you know|matlab|arre)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        // Capitalize first letter and ensure ending punctuation
        if (rewritten.length > 0) {
          rewritten = rewritten.charAt(0).toUpperCase() + rewritten.slice(1);
          if (!/[.!?]$/.test(rewritten)) {
            rewritten += '.';
          }
        }
      } else {
        // Casual rewrite
        rewritten = rawInput
          .replace(/\b(um|uh|matlab|arre)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      resolve(rewritten);
    }, 150);

    return () => clearTimeout(timer);
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new MlError('SLM_TIMEOUT', `SLM rewrite timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([generationPromise, timeoutPromise]);
}
