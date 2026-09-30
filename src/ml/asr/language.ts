import { Lang } from '../types';

/**
 * Bilingual / code-switched language strategy for Whisper.
 *
 * Whisper detects a single dominant language per 30s window. On Hinglish
 * recordings (Hindi + English mixed in one utterance) a bare `language:
 * undefined` call biases the entire output toward whichever language begins
 * the clip. This module:
 *  - always attaches a bilingual initial-prompt hint,
 *  - forces a language for explicit user choices and unreliable short clips,
 *  - leaves detection to the model only when auto-detect on longer audio.
 */

export const HINGLISH_PROMPT =
  'The following is a voice note in Hinglish, a mix of Hindi and English. ' +
  'Transcribe Hindi speech in Devanagari script and English speech in Latin letters. ' +
  'Preserve names, numbers, dates, and technical terms exactly as spoken. ' +
  'Do not translate or summarize the content.';

export const TECHNICAL_VOCAB_HINT =
  'Vocabulary: Python, CPython, struct, C struct, GC, gc.collect, memory, runtime, API, JSON, async, RAM.';

export const HINGLISH_EXAMPLE =
  'Example: "Meeting kal subah 10 baje hui thi, schedule update kar do."';

export interface AsrLanguageStrategy {
  /** Explicit Whisper language hint. `undefined` lets Whisper auto-detect. */
  language: 'en' | 'hi' | undefined;
  /** initial_prompt passed to Whisper to steer script/domain. */
  prompt: string | undefined;
}

/**
 * Decides the Whisper language hint + bilingual prompt for a clip.
 */
export function computeLanguageStrategy(
  lang: Lang,
  audioDurationMs: number,
  prompt?: string
): AsrLanguageStrategy {
  const basePrompt = prompt ?? `${HINGLISH_PROMPT}\n${TECHNICAL_VOCAB_HINT}\n${HINGLISH_EXAMPLE}`;

  switch (lang) {
    case 'en':
      return { language: 'en', prompt: basePrompt };
    case 'hi':
      return { language: 'hi', prompt: basePrompt };
    case 'auto':
    default:
      // Whisper language detection is unreliable on clips shorter than ~1.5s.
      // Default to 'en' rather than trusting the detector.
      if (audioDurationMs > 0 && audioDurationMs < 1500) {
        return { language: 'en', prompt: basePrompt };
      }
      return { language: undefined, prompt: basePrompt };
  }
}

/** True when the text contains Devanagari (Hindi script) characters. */
export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/** True when the text contains Latin (a–z / A–Z) characters. */
export function hasLatin(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

/**
 * Picks a dominant detected language for the merged result.
 * Case is irrelevant (a single isolated English word in an otherwise Hindi
 * note should not flip the whole note to English).
 */
export function dominantDetectedLang(
  counts: Partial<Record<'en' | 'hi', number>>,
  hasHindiText: boolean
): 'en' | 'hi' {
  const en = counts.en ?? 0;
  const hi = counts.hi ?? 0;
  if (hi > en) {
    return 'hi';
  }
  if (hasHindiText) {
    return 'hi';
  }
  return 'en';
}