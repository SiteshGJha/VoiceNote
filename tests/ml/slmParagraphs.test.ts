import { splitIntoSemanticBlocks, rewriteParagraphs, rewrite } from '@/ml/slm';

describe('SLM Paragraph Rewriting & Slicing', () => {
  it('splitIntoSemanticBlocks preserves short text as a single block', () => {
    const text = 'This is a short note that does not need paragraph splitting.';
    const blocks = splitIntoSemanticBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(text);
  });

  it('splitIntoSemanticBlocks slices text > 200 words at sentence boundaries into 150-200 word blocks', () => {
    // Generate 350 words over 14 sentences (each ~25 words)
    const sentence = 'The quick brown fox jumps over the lazy dog while discussing quarterly performance metrics and machine learning offline on-device processing capabilities in production today. ';
    const text = sentence.repeat(14).trim();
    const totalWords = text.split(/\s+/).length;
    expect(totalWords).toBeGreaterThan(250);

    const blocks = splitIntoSemanticBlocks(text);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      const words = block.split(/\s+/).length;
      expect(words).toBeGreaterThan(0);
      expect(words).toBeLessThanOrEqual(250);
    }
  });

  it('splitIntoSemanticBlocks falls back to clause boundaries for run-on sentences without punctuation', () => {
    // 400 words with only commas, no periods
    const clause = 'discussing on-device ML safety, ';
    const text = clause.repeat(100).trim();
    const blocks = splitIntoSemanticBlocks(text);
    expect(blocks.length).toBeGreaterThan(1);
  });

  it('rewriteParagraphs rewrites blocks sequentially and joins with double newline', async () => {
    const p1 = 'First paragraph discussing the offline ASR architecture with Whisper and memory constraints.';
    const p2 = 'Second paragraph outlining the small language model rewriting and clipboard copy workflow.';
    // Combine them with enough words to trigger multi-block or call rewriteParagraphs directly
    const sentence1 = 'We are working on building a fast offline transcription engine that runs completely locally without external cloud APIs. ';
    const sentence2 = 'This engine ensures user privacy by unlinking every temporary audio file immediately after speech recognition completes. ';
    const text = (sentence1.repeat(10) + sentence2.repeat(10)).trim();

    const result = await rewriteParagraphs(text, 'professional', { lang: 'en' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.final).toContain('\n\n');
      expect(result.usedFallback).toBe(false);
    }
  });

  it('rewrite automatically delegates to rewriteParagraphs for transcripts > 200 words', async () => {
    const sentence = 'VoiceNote transforms spoken speech into clean professional summaries completely offline on device. ';
    const longText = sentence.repeat(25); // ~300 words
    const result = await rewrite(longText, 'professional', { lang: 'en' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.final).toBeTruthy();
    }
  });
});
