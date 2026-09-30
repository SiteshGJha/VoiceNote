import { computeStats } from '@/services/statsEngine';
import { TranscriptionRecord } from '@/services/history/types';

describe('Offline Reports Engine (statsEngine)', () => {
  it('handles empty records cleanly without NaN or division by zero', () => {
    const stats = computeStats([], 'week', new Date('2026-09-30T12:00:00Z'));
    expect(stats.totalWords).toBe(0);
    expect(stats.totalNotes).toBe(0);
    expect(stats.avgWordsPerNote).toBe(0);
    expect(stats.totalDurationMs).toBe(0);
    expect(stats.byTone.professional).toBe(0);
    expect(stats.byTone.casual).toBe(0);
    expect(stats.topHour).toBeNull();
    expect(stats.dailyCounts).toHaveLength(7);
  });

  it('aggregates weekly statistics correctly', () => {
    // 2026-09-30 is Wednesday
    const r1: TranscriptionRecord = {
      id: '1',
      timestamp: '2026-09-30T10:15:00Z', // Wed, hour 10
      rawText: 'hello',
      finalText: 'Hello there everyone in team',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 3000,
      processingDurationMs: 400,
      wordCount: 5,
    };

    const r2: TranscriptionRecord = {
      id: '2',
      timestamp: '2026-09-30T10:45:00Z', // Wed, hour 10
      rawText: 'hi',
      finalText: 'Coffee break time',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 2000,
      processingDurationMs: 300,
      wordCount: 3,
    };

    const r3: TranscriptionRecord = {
      id: '3',
      timestamp: '2026-09-29T14:00:00Z', // Tue, hour 14
      rawText: 'hindi',
      finalText: 'आज का काम पूरा हुआ',
      tone: 'professional',
      lang: 'hi',
      audioDurationMs: 4000,
      processingDurationMs: 500,
      wordCount: 5,
    };

    // Outside the current week (e.g. 2 weeks prior)
    const rOld: TranscriptionRecord = {
      id: '4',
      timestamp: '2026-09-10T10:00:00Z',
      rawText: 'old',
      finalText: 'Old note from previous week',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 5000,
      processingDurationMs: 600,
      wordCount: 5,
    };

    const stats = computeStats([r1, r2, r3, rOld], 'week', new Date('2026-09-30T12:00:00Z'));
    expect(stats.totalNotes).toBe(3);
    expect(stats.totalWords).toBe(13);
    expect(stats.avgWordsPerNote).toBe(Math.round(13 / 3));
    expect(stats.totalDurationMs).toBe(9000);
    expect(stats.byTone.professional).toBe(10);
    expect(stats.byTone.casual).toBe(3);
    expect(stats.byLang.en).toBe(8);
    expect(stats.byLang.hi).toBe(5);
    expect(stats.topHour).toBe(10);
  });

  it('aggregates monthly statistics correctly', () => {
    const r1: TranscriptionRecord = {
      id: '1',
      timestamp: '2026-09-05T09:00:00Z',
      rawText: 'note 1',
      finalText: 'First note of September',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 2000,
      processingDurationMs: 300,
      wordCount: 4,
    };

    const r2: TranscriptionRecord = {
      id: '2',
      timestamp: '2026-09-25T11:00:00Z',
      rawText: 'note 2',
      finalText: 'Second note of September',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 3000,
      processingDurationMs: 400,
      wordCount: 4,
    };

    const rAugust: TranscriptionRecord = {
      id: '3',
      timestamp: '2026-08-28T11:00:00Z',
      rawText: 'aug',
      finalText: 'August note',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 3000,
      processingDurationMs: 400,
      wordCount: 2,
    };

    const stats = computeStats([r1, r2, rAugust], 'month', new Date('2026-09-30T12:00:00Z'));
    expect(stats.totalNotes).toBe(2);
    expect(stats.totalWords).toBe(8);
    expect(stats.label).toContain('September');
    expect(stats.dailyCounts.length).toBe(30); // September has 30 days
  });

  it('aggregates yearly statistics correctly', () => {
    const r1: TranscriptionRecord = {
      id: '1',
      timestamp: '2026-02-15T09:00:00Z',
      rawText: 'feb',
      finalText: 'Note in February',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 2000,
      processingDurationMs: 300,
      wordCount: 3,
    };

    const r2: TranscriptionRecord = {
      id: '2',
      timestamp: '2026-09-15T15:00:00Z',
      rawText: 'sep',
      finalText: 'Note in September',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 4000,
      processingDurationMs: 500,
      wordCount: 3,
    };

    const stats = computeStats([r1, r2], 'year', new Date('2026-09-30T12:00:00Z'));
    expect(stats.totalNotes).toBe(2);
    expect(stats.totalWords).toBe(6);
    expect(stats.label).toContain('2026');
    expect(stats.dailyCounts.length).toBe(12); // 12 months for year view
  });
});
