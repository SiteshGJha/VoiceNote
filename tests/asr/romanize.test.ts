import { romanizeHindi } from '@/ml/asr/romanize';

describe('Hindi Romanization Transliteration', () => {
  it('romanizes common Devanagari Hindi words accurately', () => {
    expect(romanizeHindi('नमस्ते')).toContain('namaste');
    expect(romanizeHindi('भारत')).toContain('bhaarat');
    expect(romanizeHindi('धन्यवाद')).toContain('dhanyavaad');
  });

  it('preserves existing English text, numbers, and punctuation intact', () => {
    const input = 'कल meeting 10am पर है!';
    const output = romanizeHindi(input);
    expect(output).toContain('meeting');
    expect(output).toContain('10am');
    expect(output).toContain('!');
  });
});
