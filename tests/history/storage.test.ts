import { historyStorage, MAX_HISTORY_RECORDS } from '@/services/history';

describe('Encrypted History Storage & FIFO Eviction', () => {
  beforeEach(async () => {
    await historyStorage.clearAll();
  });

  it('enforces strict FIFO eviction at 500 records', async () => {
    expect(MAX_HISTORY_RECORDS).toBe(500);

    // Add 505 records
    for (let i = 1; i <= 505; i++) {
      await historyStorage.addRecord({
        rawText: `Raw note number ${i}`,
        finalText: `Final note number ${i}`,
        tone: 'professional',
        lang: 'en',
        audioDurationMs: 2000,
        processingDurationMs: 500,
      });
    }

    const records = await historyStorage.listRecords();

    // Capacity must never exceed 500
    expect(records.length).toBe(500);

    // Newest record must be record 505
    expect(records[0]?.rawText).toBe('Raw note number 505');

    // Oldest surviving record must be record 6 (records 1-5 dropped by FIFO)
    const oldestRecord = records[records.length - 1];
    expect(oldestRecord?.rawText).toBe('Raw note number 6');
  });

  it('supports deleting an individual record', async () => {
    const r1 = await historyStorage.addRecord({
      rawText: 'First note',
      finalText: 'First note',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });

    const r2 = await historyStorage.addRecord({
      rawText: 'Second note',
      finalText: 'Second note',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });

    let records = await historyStorage.listRecords();
    expect(records.length).toBe(2);

    const deleted = await historyStorage.deleteRecord(r1.id);
    expect(deleted).toBe(true);

    records = await historyStorage.listRecords();
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe(r2.id);
  });

  it('supports clearAll to delete all records', async () => {
    await historyStorage.addRecord({
      rawText: 'To be wiped',
      finalText: 'To be wiped',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });

    await historyStorage.clearAll();
    const records = await historyStorage.listRecords();
    expect(records.length).toBe(0);
  });
});
