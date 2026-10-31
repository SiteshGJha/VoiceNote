import { normalizeTranscript, isEmptyTranscript } from '@/ml/asr/normalize';

describe('Transcript Normalization', () => {
  it('collapses whitespace runs', () => {
    expect(normalizeTranscript('Hello   world\n\nPeace.')).toBe('Hello world Peace.');
  });

  it('fixes space-before-punctuation and missing space after', () => {
    expect(normalizeTranscript('Hello ,world')).toBe('Hello, world');
    expect(normalizeTranscript('Meeting at 10am,please join.')).toBe('Meeting at 10am, please join.');
  });

  it('collapses repeated punctuation', () => {
    expect(normalizeTranscript('What!! No way..')).toBe('What! No way.');
  });

  it('preserves Devanagari text while fixing spacing', () => {
    const out = normalizeTranscript('कल   सुबह 10 बजे ,मीटिंग है।');
    expect(out).toBe('कल सुबह 10 बजे, मीटिंग है।');
  });

  it('trims leading/trailing punctuation and whitespace', () => {
    expect(normalizeTranscript('  , Hello there!  ')).toBe('Hello there!');
  });

  it('treats empty/symbol-only transcripts as empty', () => {
    expect(isEmptyTranscript('   ')).toBe(true);
    expect(isEmptyTranscript('...')).toBe(true);
    expect(isEmptyTranscript('A real note')).toBe(false);
  });

  it('can disable options explicitly', () => {
    expect(normalizeTranscript('a   b', { collapseWhitespace: false })).toBe('a   b');
  });
});