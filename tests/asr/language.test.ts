import { computeLanguageStrategy, dominantDetectedLang, hasDevanagari, hasLatin } from '@/ml/asr/language';

describe('ASR Language Strategy', () => {
  it('uses explicit English hint and bilingual prompt', () => {
    const strat = computeLanguageStrategy('en', 5000);
    expect(strat.language).toBe('en');
    expect(strat.prompt).toContain('Hinglish');
  });

  it('uses explicit Hindi hint and bilingual prompt', () => {
    const strat = computeLanguageStrategy('hi', 5000);
    expect(strat.language).toBe('hi');
    expect(strat.prompt).toContain('Devanagari');
  });

  it('lets Whisper auto-detect on long clips, with a code-switch example', () => {
    const strat = computeLanguageStrategy('auto', 8000);
    expect(strat.language).toBeUndefined();
    expect(strat.prompt).toContain('Example:');
  });

  it('defaults short auto clips (<1.5s) to English because detection is unreliable', () => {
    const strat = computeLanguageStrategy('auto', 900);
    expect(strat.language).toBe('en');
  });

  it('preserves a caller-provided prompt', () => {
    const strat = computeLanguageStrategy('auto', 5000, 'Custom hint here');
    expect(strat.prompt).toBe('Custom hint here');
  });

  it('includes common technical programming terms in prompt when transcribing English', () => {
    const strat = computeLanguageStrategy('en', 5000);
    // Technical vocabulary biasing prevents "C struct" -> "sea struck"
    expect(strat.prompt).toContain('CPython');
    expect(strat.prompt).toContain('struct');
    expect(strat.prompt).toContain('GC');
  });

  it('detects Devanagari and Latin scripts', () => {
    expect(hasDevanagari('यह एक नोट है।')).toBe(true);
    expect(hasDevanagari('This is a note.')).toBe(false);
    expect(hasLatin('This is a note.')).toBe(true);
    expect(hasLatin('यह एक नोट है।')).toBe(false);
  });

  it('reports dominant language by counts, with Hindi-script text as tie-breaker', () => {
    expect(dominantDetectedLang({ en: 2, hi: 1 }, false)).toBe('en');
    expect(dominantDetectedLang({ en: 1, hi: 2 }, false)).toBe('hi');
    // Equal counts but Devanagari present -> Hindi (safer for romanization)
    expect(dominantDetectedLang({ en: 1, hi: 1 }, true)).toBe('hi');
    // No counts but Devanagari present (short single-segment) -> Hindi only if text says so
    expect(dominantDetectedLang({ en: 0, hi: 0 }, false)).toBe('en');
  });
});