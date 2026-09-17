import { Tone, DetectedLang } from '../types';

export const SLM_PARAMS = {
  temperature: 0.3, // low — we want faithful rewriting, not creativity
  topP: 0.9,
  maxTokens: 512,
  stop: ['\n\n', 'Input:', 'Output:'],
  repeatPenalty: 1.1,
} as const;

// Backwards compatibility alias
export const SLM_GENERATION_PARAMS = SLM_PARAMS;

const CANONICAL_TEMPLATES = {
  professional: {
    description: 'You rewrite spoken text into clear, professional writing.',
    rules: [
      'Remove filler words (um, uh, like, you know, matlab, arre).',
      'Use complete sentences. No contractions.',
      'Preserve every fact, name, number, and date exactly.',
      'Do not add information that is not in the input.',
      'Output only the rewritten text. No preamble, no quotes.',
    ],
  },
  casual: {
    description: 'You rewrite spoken text into natural, casual writing.',
    rules: [
      'Keep contractions and everyday phrasing.',
      'Light cleanup only — do not formalize.',
      'Preserve every fact, name, number, and date exactly.',
      'Output only the rewritten text. No preamble, no quotes.',
    ],
  },
};

/**
 * Constructs canonical tone prompt using slot substitution: {TONE}, {LANG}, {RAW}, {RULES}.
 */
export function buildPrompt(rawText: string, tone: Tone, lang: DetectedLang): string {
  const languageName = lang === 'hi' ? 'Hindi' : 'English';
  const template = CANONICAL_TEMPLATES[tone];

  const rulesFormatted = [
    ...template.rules.map((r) => `- ${r}`),
    `- Language: ${languageName}.`,
  ].join('\n');

  return `${template.description}
Rules:
${rulesFormatted}

Input: ${rawText}
Output:`;
}
