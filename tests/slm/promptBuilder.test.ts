import { buildPrompt } from '@/ml/slm/promptBuilder';

describe('SLM Prompt Builder', () => {
  it('generates canonical professional prompt with filler removal rules', () => {
    const raw = 'Um like we need to talk to John tomorrow.';
    const prompt = buildPrompt(raw, 'professional', 'en');

    expect(prompt).toContain('You rewrite spoken text into clear, professional writing.');
    expect(prompt).toContain('Remove filler words (um, uh, like, you know, matlab, arre).');
    expect(prompt).toContain('No contractions.');
    expect(prompt).toContain('Preserve every fact, name, number, and date exactly.');
    expect(prompt).toContain(`Input: ${raw}`);
    expect(prompt).toContain('Output:');
  });

  it('generates canonical casual prompt with conversational rules', () => {
    const raw = 'We are going to visit Delhi on Tuesday.';
    const prompt = buildPrompt(raw, 'casual', 'en');

    expect(prompt).toContain('You rewrite spoken text into natural, casual writing.');
    expect(prompt).toContain('Keep contractions and everyday phrasing.');
    expect(prompt).toContain('Light cleanup only — do not formalize.');
    expect(prompt).toContain(`Input: ${raw}`);
  });
});
