import { validatePreservation, extractCriticalEntities } from '@/ml/slm/validator';

describe('SLM Meaning Preservation Guard', () => {
  it('extracts numbers, dates, and proper nouns accurately', () => {
    const text = 'Meeting with Alice at 3pm on October 15 costs $250.';
    const entities = extractCriticalEntities(text);

    expect(entities).toContain('alice');
    expect(entities).toContain('3pm');
    expect(entities).toContain('15');
    expect(entities).toContain('$250');
  });

  it('passes validation when all critical facts are preserved in final output', () => {
    const raw = 'We owe Rahul $450 by March 12.';
    const final = 'The amount of $450 is due to Rahul by March 12.';
    const result = validatePreservation(raw, final);

    expect(result.isValid).toBe(true);
  });

  it('fails validation when a critical entity is omitted or altered', () => {
    const raw = 'Order 500 units for client AcmeCorp before Friday.';
    // Omitted '500' and 'AcmeCorp'
    const final = 'Order units for client before Friday.';
    const result = validatePreservation(raw, final);

    expect(result.isValid).toBe(false);
    expect(result.missingEntities).toContain('500');
    expect(result.missingEntities).toContain('acmecorp');
  });

  it('fails validation when output text collapses or expands excessively', () => {
    const raw = 'This is a standard thirty character long sentence.';
    const collapsed = 'Hi.';
    const result = validatePreservation(raw, collapsed);

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Length ratio');
  });
});
