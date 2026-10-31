/**
 * Lightweight transcript normalization.
 *
 * Whisper raw output commonly carries spacing/punctuation noise (e.g.
 * `"Hello ,world"`, double spaces, repeated punctuation, no space after a
 * comma). Cleaning it before the tone-rewrite stage measurably improves
 * SLM output quality and keeps history records tidy.
 */

export interface NormalizationOptions {
  /** Collapse runs of whitespace into a single space. Default true. */
  collapseWhitespace?: boolean;
  /** Fix spacing around punctuation: no space before, one space after. */
  fixPunctuationSpacing?: boolean;
  /** Collapse repeated punctuation (e.g. "!!", "..") into a single mark. */
  collapseRepeatedPunctuation?: boolean;
  /** Strip leading/trailing punctuation and whitespace. Default true. */
  trimEdges?: boolean;
}

const REPEATABLE_PUNCTUATION = /[.,!?;:]/;

export function normalizeTranscript(rawText: string, options: NormalizationOptions = {}): string {
  const {
    collapseWhitespace = true,
    fixPunctuationSpacing = true,
    collapseRepeatedPunctuation = true,
    trimEdges = true,
  } = options;

  let text = (rawText ?? '').normalize('NFC');

  if (collapseWhitespace) {
    text = text.replace(/\s+/g, ' ');
  }

  if (fixPunctuationSpacing) {
    // Remove space(s) before sentence punctuation: "Hello ," -> "Hello,"
    text = text.replace(/\s+([.,!?;:])/g, '$1');
    // Add single space after sentence punctuation when followed by a letter/digit.
    text = text.replace(/([.,!?;:])(?=[^\s.,!?;:"'])/g, '$1 ');
  }

  if (collapseRepeatedPunctuation) {
    text = text.replace(/([.,!?;:])\1+/g, '$1');
    // Clean up artifacts created by the pass above ("a,  b" double-spaces),
    // but only when whitespace collapsing is enabled by the caller.
    if (collapseWhitespace) {
      text = text.replace(/\s+/g, ' ');
    }
  }

  // Normalize space around em-dashes while keeping them usable in Hindi/English.
  text = text.replace(/\s*—\s*/g, ' — ');

  if (trimEdges) {
    // Strip stray leading punctuation/whitespace; keep meaningful trailing
    // sentence punctuation (.!? and Devanagari danda).
    text = text.replace(/^[.,!?;:\s]+/, '');
  }

  return text.trim();
}

/** Convenience guard: true if normalized text is empty. */
export function isEmptyTranscript(text: string): boolean {
  return normalizeTranscript(text).length === 0;
}