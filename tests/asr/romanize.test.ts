import { romanizeHindi } from '@/ml/asr/romanize';

describe('Hindi Romanization Transliteration', () => {
  it('romanizes common Devanagari Hindi words accurately', () => {
    expect(romanizeHindi('नमस्ते')).toContain('namaste');
    expect(romanizeHindi('भारत')).toContain('bhaarat');
    expect(romanizeHindi('धन्यवाद')).toContain('dhanyavaad');
  });

  it('romanizes complex Hindi conjuncts and nuktas', () => {
    // क्ष -> ksh, त्र -> tr, ज्ञ -> gy, श्र -> shr
    expect(romanizeHindi('परीक्षा')).toContain('pareekshaa');
    expect(romanizeHindi('मित्र')).toContain('mitra');
    expect(romanizeHindi('ज्ञान')).toContain('gyaan');
    expect(romanizeHindi('श्री')).toContain('shree');

    // Nukta consonants
    expect(romanizeHindi('ज़िंदगी')).toContain('zindagee');
    expect(romanizeHindi('फ़ोन')).toContain('fon');
  });

  it('preserves existing English text, numbers, and punctuation intact', () => {
    const input = 'कल meeting 10am पर है!';
    const output = romanizeHindi(input);
    expect(output).toContain('meeting');
    expect(output).toContain('10am');
    expect(output).toContain('!');
  });
});
