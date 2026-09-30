import { logger } from '@/utils/logger';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  missingEntities?: string[];
}

/**
 * Extracts numbers, percentages, dates/times, and capitalized proper nouns from text.
 */
export function extractCriticalEntities(text: string): string[] {
  const entities: Set<string> = new Set();

  // Numbers with optional units/times (e.g. 3pm, 10am, 25%, $250, 4.5)
  const numberRegex = /[$€₹£]?\b\d+(?:[.,]\d+)?(?:%|am|pm)?\b/gi;
  const numbers = text.match(numberRegex) ?? [];
  for (const num of numbers) {
    entities.add(num.toLowerCase());
  }

  const FILLER_WORDS = new Set([
    'um', 'uh', 'like', 'matlab', 'arre', 'er', 'ah', 'haan', 'acha', 'bhai', 'yaar', 'okay', 'ok',
  ]);

  // Proper nouns (Capitalized words, camelCase, PascalCase, or uppercase abbreviations)
  const words = text.split(/\s+/);
  const commonStarters = new Set([
    'the', 'this', 'that', 'these', 'those', 'we', 'they', 'you', 'it', 'order',
    'please', 'a', 'an', 'in', 'on', 'at', 'if', 'when', 'there', 'here', 'let',
    'lets', "let's", 'my', 'our', 'his', 'her', 'their', 'hello', 'hi', 'hey',
    'so', 'also', 'just', 'can', 'could', 'would', 'should',
  ]);

  for (let i = 0; i < words.length; i++) {
    const word = words[i]?.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (!word) {
      continue;
    }
    const lowerWord = word.toLowerCase();
    if (FILLER_WORDS.has(lowerWord)) {
      continue;
    }
    if (/^[A-Z][a-zA-Z0-9_-]+$/.test(word)) {
      if (i === 0 && commonStarters.has(lowerWord)) {
        continue;
      }
      entities.add(lowerWord);
    }
  }

  return Array.from(entities);
}

/**
 * Validates that rewritten text faithfully preserves critical entities and reasonable length.
 */
export function validatePreservation(raw: string, final: string): ValidationResult {
  const trimmedRaw = raw.trim();
  const trimmedFinal = final.trim();

  if (!trimmedFinal) {
    return {
      isValid: false,
      reason: 'Rewritten text is empty',
    };
  }

  // 1. Length ratio check: final length must be within 0.35x to 2.5x of raw (allowing for concise tone)
  const rawLen = trimmedRaw.length;
  const finalLen = trimmedFinal.length;
  if (rawLen > 10) {
    const ratio = finalLen / rawLen;
    if (ratio < 0.35 || ratio > 2.5) {
      logger.warn('SLMValidator', `Length drift detected: ratio=${ratio.toFixed(2)}`);
      return {
        isValid: false,
        reason: `Length ratio out of safe bounds: ${ratio.toFixed(2)}`,
      };
    }
  }

  // 2. Entity extraction and preservation
  const rawEntities = extractCriticalEntities(trimmedRaw);
  const finalLower = trimmedFinal.toLowerCase();
  const missing: string[] = [];

  for (const entity of rawEntities) {
    const stripped = entity.replace(/[$€₹£]/g, '');
    let found = finalLower.includes(entity) || (stripped.length > 0 && finalLower.includes(stripped));

    // Handle time variants: "3pm" <-> "3:00 pm" or "3 pm"
    if (!found && /^\d+(?:am|pm)$/.test(entity)) {
      const hour = entity.replace(/(am|pm)/, '');
      const period = entity.slice(-2);
      const variant1 = `${hour}:00 ${period}`;
      const variant2 = `${hour}:00${period}`;
      const variant3 = `${hour} ${period}`;
      found = finalLower.includes(variant1) || finalLower.includes(variant2) || finalLower.includes(variant3);
    }

    // Handle ordinal variants: "15th" <-> "15"
    if (!found && /^\d+(?:st|nd|rd|th)$/.test(entity)) {
      const baseNum = entity.replace(/(st|nd|rd|th)/, '');
      found = new RegExp(`\\b${baseNum}\\b`).test(finalLower);
    }

    if (!found) {
      missing.push(entity);
    }
  }

  if (missing.length > 0) {
    logger.warn('SLMValidator', `Missing critical entities in rewritten text: ${missing.join(', ')}`);
    return {
      isValid: false,
      reason: `Critical entities missing: ${missing.join(', ')}`,
      missingEntities: missing,
    };
  }

  return { isValid: true };
}
