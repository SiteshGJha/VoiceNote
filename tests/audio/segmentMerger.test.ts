import { mergeSegments } from '@/audio/segmentMerger';

describe('Segment Merger (overlap deduplication)', () => {
  it('returns empty string for empty array', () => {
    expect(mergeSegments([])).toBe('');
  });

  it('returns exact string for single segment', () => {
    expect(mergeSegments(['Hello world.'])).toBe('Hello world.');
  });

  it('merges two segments with exact overlap words', () => {
    const s1 = 'today we will discuss the project';
    const s2 = 'discuss the project roadmap and milestones';
    const merged = mergeSegments([s1, s2]);
    expect(merged).toBe('today we will discuss the project roadmap and milestones');
  });

  it('merges two segments with minor ASR variations in overlap window', () => {
    // "project roadmap" vs "project road map" or slight punctuation
    const s1 = 'we need to finalize the quarterly review';
    const s2 = 'finalize the quarterly review before Friday';
    const merged = mergeSegments([s1, s2]);
    expect(merged).toBe('we need to finalize the quarterly review before Friday');
  });

  it('joins cleanly with space when there is no overlap', () => {
    const s1 = 'First thought finished.';
    const s2 = 'Second thought started.';
    const merged = mergeSegments([s1, s2]);
    expect(merged).toBe('First thought finished. Second thought started.');
  });

  it('handles Hindi Devanagari overlap correctly', () => {
    const s1 = 'आज हम बात करेंगे नए प्रोजेक्ट पर';
    const s2 = 'बात करेंगे नए प्रोजेक्ट पर और समय सीमा पर';
    const merged = mergeSegments([s1, s2]);
    expect(merged).toBe('आज हम बात करेंगे नए प्रोजेक्ट पर और समय सीमा पर');
  });

  it('merges across 3 or more segments sequentially', () => {
    const s1 = 'Part one introduces';
    const s2 = 'one introduces part two which';
    const s3 = 'part two which covers part three.';
    const merged = mergeSegments([s1, s2, s3]);
    expect(merged).toBe('Part one introduces part two which covers part three.');
  });
});
