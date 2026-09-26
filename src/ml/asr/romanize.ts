/**
 * Transliterates Hindi Devanagari Unicode text to Romanized (Latin) script.
 * Uses a deterministic phonetic transliteration table with conjunct and nukta handling.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONJUNCTS: Record<string, string> = {
  'क्ष': 'ksha',
  'त्र': 'tra',
  'ज्ञ': 'gya',
  'श्र': 'shra',
  'द्य': 'dya',
  'द्व': 'dva',
};

const NUKTA_CONSONANTS: Record<string, string> = {
  'ज': 'z',
  'फ': 'f',
  'क': 'q',
  'ख': 'kh',
  'ग': 'gh',
  'ड': 'r',
  'ढ': 'rh',
};

const PRECOMPOSED_NUKTA: Record<string, string> = {
  'ज़': 'z',
  'फ़': 'f',
  'क़': 'q',
  'ख़': 'kh',
  'ग़': 'gh',
  'ड़': 'r',
  'ढ़': 'rh',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
};

const MODIFIERS: Record<string, string> = {
  'ं': 'n', // Anusvara
  'ः': 'h', // Visarga
  'ँ': 'n', // Chandrabindu
  '्': '',  // Virama (halant) - suppresses inherent 'a'
};

export function romanizeHindi(rawText: string): string {
  const text = rawText.normalize('NFC');
  let result = '';
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];
    if (!char) continue;

    // 1. Check conjuncts first (e.g. क्ष, त्र, ज्ञ, श्र)
    let matchedConjunct = false;
    for (const [conj, rep] of Object.entries(CONJUNCTS)) {
      if (text.startsWith(conj, i)) {
        const nextChar = i + conj.length < len ? text[i + conj.length] : null;
        if (nextChar && MATRAS[nextChar] !== undefined) {
          result += rep.replace(/a$/, '') + MATRAS[nextChar];
          i += conj.length;
        } else {
          result += rep;
          i += conj.length - 1;
        }
        matchedConjunct = true;
        break;
      }
    }
    if (matchedConjunct) continue;

    // 2. Check independent vowel
    if (VOWELS[char] !== undefined) {
      result += VOWELS[char];
      continue;
    }

    // 3. Check matra
    if (MATRAS[char] !== undefined) {
      result += MATRAS[char];
      continue;
    }

    // 4. Check modifier
    if (MODIFIERS[char] !== undefined) {
      result += MODIFIERS[char];
      continue;
    }

    // 5. Check consonants (including precomposed and decomposed nuktas)
    let base: string | undefined;

    if (PRECOMPOSED_NUKTA[char] !== undefined) {
      base = PRECOMPOSED_NUKTA[char];
    } else if (CONSONANTS[char] !== undefined) {
      base = CONSONANTS[char];
      // Check if immediately followed by combining nukta (U+093C)
      if (i + 1 < len && (text[i + 1] === '़' || text[i + 1] === '\u093C')) {
        base = NUKTA_CONSONANTS[char] ?? base;
        i++; // skip nukta character
      }
    }

    if (base !== undefined) {
      const nextChar = i + 1 < len ? text[i + 1] : null;

      if (nextChar === '्') {
        // Virama suppresses inherent vowel
        result += base;
        i++; // Skip virama
      } else if (nextChar && MATRAS[nextChar] !== undefined) {
        // Matra replaces inherent vowel
        result += base + MATRAS[nextChar];
        i++; // Skip matra
      } else if (nextChar && MODIFIERS[nextChar] !== undefined) {
        result += base + 'a' + MODIFIERS[nextChar];
        i++;
      } else if (nextChar === ' ' || nextChar === null || /[.,!?;:\n]/.test(nextChar ?? '')) {
        // Word boundary drops inherent vowel
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
