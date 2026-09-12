/**
 * Transliterates Hindi Devanagari Unicode text to Romanized (Latin) script.
 * Uses a standard phonetic transliteration table without invoking heavy models.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'ज़': 'z', 'ख़': 'kh', 'ग़': 'gh',
};

const MODIFIERS: Record<string, string> = {
  'ं': 'n', // Anusvara
  'ः': 'h', // Visarga
  'ँ': 'n', // Chandrabindu
  '्': '',  // Virama (halant) - suppresses inherent 'a'
};

export function romanizeHindi(text: string): string {
  let result = '';
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];
    if (!char) continue;

    // Check independent vowel
    if (VOWELS[char] !== undefined) {
      result += VOWELS[char];
      continue;
    }

    // Check matra
    if (MATRAS[char] !== undefined) {
      result += MATRAS[char];
      continue;
    }

    // Check modifier
    if (MODIFIERS[char] !== undefined) {
      result += MODIFIERS[char];
      continue;
    }

    // Check consonant
    if (CONSONANTS[char] !== undefined) {
      const base = CONSONANTS[char];
      const nextChar = i + 1 < len ? text[i + 1] : null;

      // In Devanagari, consonants have an inherent 'a' unless followed by a matra, virama, or end of word
      if (nextChar === '्') {
        // Virama suppresses inherent vowel
        result += base;
        i++; // Skip the virama
      } else if (nextChar && MATRAS[nextChar] !== undefined) {
        // Matra replaces inherent vowel
        result += base + MATRAS[nextChar];
        i++; // Skip the matra
      } else if (nextChar && MODIFIERS[nextChar] !== undefined) {
        result += base + 'a' + MODIFIERS[nextChar];
        i++;
      } else if (nextChar === ' ' || nextChar === null || /[.,!?;:\n]/.test(nextChar ?? '')) {
        // Word boundary usually drops inherent schwa in spoken Hindi
        result += base;
      } else {
        result += base + 'a';
      }
      continue;
    }

    // Retain punctuation, digits, Latin characters as-is
    result += char;
  }

  return result;
}
