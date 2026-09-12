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

  // Proper nouns (Capitalized words, camelCase, PascalCase, or uppercase abbreviations)
  const words = text.split(/\s+/);
  const commonStarters = ['the', 'this', 'that', 'we', 'they', 'you', 'it', 'order', 'please', 'a', 'an'];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]?.replace(/[.,!?;:()"]/g, '');
    if (word && /^[A-Z][a-zA-Z0-9_-]+$/.test(word)) {
      if (i === 0 && commonStarters.includes(word.toLowerCase())) {
        continue;
      }
      entities.add(word.toLowerCase());
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

  // 1. Length ratio check: final length must be within 0.5x to 2.5x of raw
  const rawLen = trimmedRaw.length;
  const finalLen = trimmedFinal.length;
  if (rawLen > 10) {
    const ratio = finalLen / rawLen;
    if (ratio < 0.4 || ratio > 2.5) {
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
    if (!finalLower.includes(entity)) {
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
