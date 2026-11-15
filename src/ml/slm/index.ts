import { Tone, SlmOptions, SlmResult } from '../types';
import { MlError } from '../errors';
import { buildPrompt } from './promptBuilder';
import { runLlamaInference } from './llamaRunner';
import { postProcessOutput } from './postProcess';
import { validatePreservation } from './validator';
import { slmModelRegistry } from './modelRegistry';
import { logger } from '@/utils/logger';

export { slmModelRegistry };

/**
 * Splits text into semantic paragraphs targeting 150-200 words per block.
 * Uses sentence terminal punctuation, clause boundaries for run-ons, and word limits.
 */
export function splitIntoSemanticBlocks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 200) {
    return [trimmed];
  }

  // Split into sentence units
  const rawSentences = trimmed
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const normalizedUnits: string[] = [];

  for (const sentence of rawSentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean);
    if (sentenceWords.length <= 180) {
      normalizedUnits.push(sentence);
    } else {
      // Run-on sentence fallback: split by clause boundaries (, ; : —)
      const clauses = sentence.split(/(?<=[,;:—])\s+/).filter(Boolean);
      let currentClauseAcc: string[] = [];
      let currentClauseWords = 0;

      for (const clause of clauses) {
        const cWords = clause.split(/\s+/).filter(Boolean);
        if (currentClauseWords + cWords.length > 180 && currentClauseAcc.length > 0) {
          normalizedUnits.push(currentClauseAcc.join(' '));
          currentClauseAcc = [clause];
          currentClauseWords = cWords.length;
        } else {
          currentClauseAcc.push(clause);
          currentClauseWords += cWords.length;
        }
      }
      if (currentClauseAcc.length > 0) {
        const remainingStr = currentClauseAcc.join(' ');
        const remWords = remainingStr.split(/\s+/).filter(Boolean);
        if (remWords.length <= 180) {
          normalizedUnits.push(remainingStr);
        } else {
          for (let i = 0; i < remWords.length; i += 180) {
            normalizedUnits.push(remWords.slice(i, i + 180).join(' '));
          }
        }
      }
    }
  }

  // Pack units into blocks targeting 150-200 words
  const blocks: string[] = [];
  let currentBlockUnits: string[] = [];
  let currentBlockWordCount = 0;

  for (const unit of normalizedUnits) {
    const unitWordCount = unit.split(/\s+/).filter(Boolean).length;

    if (currentBlockWordCount + unitWordCount > 200 && currentBlockUnits.length > 0) {
      blocks.push(currentBlockUnits.join(' '));
      currentBlockUnits = [unit];
      currentBlockWordCount = unitWordCount;
    } else {
      currentBlockUnits.push(unit);
      currentBlockWordCount += unitWordCount;
      if (currentBlockWordCount >= 150) {
        blocks.push(currentBlockUnits.join(' '));
        currentBlockUnits = [];
        currentBlockWordCount = 0;
      }
    }
  }

  if (currentBlockUnits.length > 0) {
    if (blocks.length > 0 && currentBlockWordCount < 50) {
      const prev = blocks[blocks.length - 1];
      if (prev) {
        const prevWordCount = prev.split(/\s+/).filter(Boolean).length;
        if (prevWordCount + currentBlockWordCount <= 250) {
          blocks[blocks.length - 1] = `${prev} ${currentBlockUnits.join(' ')}`;
        } else {
          blocks.push(currentBlockUnits.join(' '));
        }
      } else {
        blocks.push(currentBlockUnits.join(' '));
      }
    } else {
      blocks.push(currentBlockUnits.join(' '));
    }
  }

  return blocks;
}

/**
 * Rewrites an individual block with strict timeout and validation guards.
 */
async function rewriteSingleBlock(trimmedRaw: string, tone: Tone, opts: SlmOptions): Promise<SlmResult> {
  const startTime = Date.now();
  try {
    const prompt = buildPrompt(trimmedRaw, tone, opts.lang);
    const activeModel = slmModelRegistry.getActiveModel();
    const modelPath = opts.modelPath ?? activeModel.filePath ?? '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf';

    const rawGenerated = await runLlamaInference({
      prompt,
      modelPath,
      timeoutMs: opts.timeoutMs ?? 8_000,
      temperature: opts.temperature ?? 0.3,
    });

    const cleanedText = postProcessOutput(rawGenerated);

    // Run meaning preservation guard
    const validation = validatePreservation(trimmedRaw, cleanedText);
    if (!validation.isValid) {
      logger.warn('SLM', `Validation failed: ${validation.reason}. Falling back to raw transcript.`);
      return {
        status: 'error',
        code: 'SLM_HALLUCINATION_SUSPECTED',
        message: validation.reason ?? 'Suspected entity loss or length drift',
        fallbackText: trimmedRaw,
      };
    }

    const durationMs = Date.now() - startTime;
    return {
      status: 'ok',
      final: cleanedText,
      tone,
      durationMs,
      usedFallback: false,
    };
  } catch (err) {
    logger.error('SLM', 'SLM block rewrite encountered error', err);
    const code = err instanceof MlError ? err.code : 'SLM_TIMEOUT';
    const message = err instanceof Error ? err.message : 'Rewriting failed';

    return {
      status: 'error',
      code,
      message,
      fallbackText: trimmedRaw,
    };
  }
}

/**
 * Rewrites long transcripts in sequential semantic paragraphs (150-200 words each).
 * Enforces an 8-second timeout per block with isolated fallback.
 */
export async function rewriteParagraphs(
  rawText: string,
  tone: Tone,
  opts: SlmOptions
): Promise<SlmResult> {
  const startTime = Date.now();
  const trimmedRaw = rawText.trim();

  if (!trimmedRaw) {
    return {
      status: 'error',
      code: 'ASR_EMPTY_OUTPUT',
      message: 'Cannot rewrite empty text.',
      fallbackText: '',
    };
  }

  const blocks = splitIntoSemanticBlocks(trimmedRaw);

  if (blocks.length <= 1) {
    return rewriteSingleBlock(trimmedRaw, tone, opts);
  }

  logger.info('SLM', `Rewriting ${blocks.length} paragraph blocks sequentially to tone=${tone}`);

  const rewrittenBlocks: string[] = [];
  let anyBlockUsedFallback = false;
  let totalDurationMs = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) {
      continue;
    }
    const blockOpts: SlmOptions = {
      ...opts,
      timeoutMs: Math.min(opts.timeoutMs ?? 8000, 8000),
    };

    const res = await rewriteSingleBlock(block, tone, blockOpts);
    if (res.status === 'ok') {
      totalDurationMs += res.durationMs;
      rewrittenBlocks.push(res.final);
    } else {
      logger.warn('SLM', `Block ${i + 1}/${blocks.length} failed: ${res.message}. Using isolated raw fallback.`);
      rewrittenBlocks.push(block);
      anyBlockUsedFallback = true;
    }
  }

  const finalAssembly = rewrittenBlocks.join('\n\n');
  const elapsed = Date.now() - startTime;

  return {
    status: 'ok',
    final: finalAssembly,
    tone,
    durationMs: elapsed,
    usedFallback: anyBlockUsedFallback,
  };
}

/**
 * Public Tone Rewriting API.
 * Automatically delegates to rewriteParagraphs if text exceeds 200 words.
 */
export async function rewrite(rawText: string, tone: Tone, opts: SlmOptions): Promise<SlmResult> {
  const trimmedRaw = rawText.trim();

  if (!trimmedRaw) {
    return {
      status: 'error',
      code: 'ASR_EMPTY_OUTPUT',
      message: 'Cannot rewrite empty text.',
      fallbackText: '',
    };
  }

  const wordCount = trimmedRaw.split(/\s+/).filter(Boolean).length;
  if (wordCount > 200) {
    logger.info('SLM', `Transcript has ${wordCount} words (>200); delegating to rewriteParagraphs`);
    return rewriteParagraphs(trimmedRaw, tone, opts);
  }

  return rewriteSingleBlock(trimmedRaw, tone, opts);
}

