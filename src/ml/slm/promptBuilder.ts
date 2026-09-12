import { Tone, DetectedLang } from '../types';

export const SLM_GENERATION_PARAMS = {
  temperature: 0.3, // low — faithful rewriting, not creativity
  topP: 0.9,
  maxTokens: 512,
  stop: ['\n\n', 'Input:', 'Output:'],
  repeatPenalty: 1.1,
} as const;

export function buildPrompt(rawText: string, tone: Tone, lang: DetectedLang): string {
  const languageName = lang === 'hi' ? 'Hindi' : 'English';

  if (tone === 'professional') {
    return `You rewrite spoken text into clear, professional writing.
Rules:
- Remove filler words (um, uh, like, you know, matlab, arre).
- Use complete sentences. No contractions.
- Preserve every fact, name, number, and date exactly.
- Do not add information that is not in the input.
- Output only the rewritten text. No preamble, no quotes.
- Language: ${languageName}.

Input: ${rawText}
Output:`;
  }

  // Casual tone
  return `You rewrite spoken text into natural, casual writing.
Rules:
- Keep contractions and everyday phrasing.
- Light cleanup only — do not formalize.
- Preserve every fact, name, number, and date exactly.
- Output only the rewritten text. No preamble, no quotes.
- Language: ${languageName}.

Input: ${rawText}
Output:`;
}
