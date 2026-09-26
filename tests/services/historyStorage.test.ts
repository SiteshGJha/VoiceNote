import { historyStorage, MAX_HISTORY_RECORDS } from '@/services/history';

describe('History Storage Persistence & FIFO Eviction', () => {
  beforeEach(async () => {
    await historyStorage.clearAll();
  });

  it('persists records across service re-instantiation', async () => {
    await historyStorage.addRecord({
      rawText: 'hello',
      finalText: 'Hello.',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 2000,
      processingDurationMs: 300,
    });

    // Simulate restart by clearing in-memory cache without calling clearAll()
    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const records = await historyStorage.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.rawText).toBe('hello');
  });

  it('enforces strict FIFO eviction at 50 records', async () => {
    expect(MAX_HISTORY_RECORDS).toBe(50);

    for (let i = 1; i <= 55; i++) {
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
    expect(records.length).toBe(50);
    expect(records[0]?.rawText).toBe('Raw note number 55');
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

  it('persists record deletion across simulated restart', async () => {
    const r1 = await historyStorage.addRecord({
      rawText: 'First',
      finalText: 'First.',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });
    const r2 = await historyStorage.addRecord({
      rawText: 'Second',
      finalText: 'Second.',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });

    await historyStorage.deleteRecord(r1.id);

    // Simulate restart
    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const records = await historyStorage.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(r2.id);
  });

  it('persists clearAll across simulated restart', async () => {
    await historyStorage.addRecord({
      rawText: 'Note 1',
      finalText: 'Note 1.',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });
    await historyStorage.clearAll();

    // Simulate restart
    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const records = await historyStorage.listRecords();
    expect(records).toHaveLength(0);
  });

  it('handles corrupted JSON in storage gracefully', async () => {
    await historyStorage.addRecord({
      rawText: 'Valid',
      finalText: 'Valid.',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 200,
    });

    // Directly corrupt MMKV stored data
    const storageInstance = (historyStorage as any).storage;
    storageInstance.set('records', '{ invalid json syntax }');

    // Simulate restart
    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const records = await historyStorage.listRecords();
    expect(records).toEqual([]);
  });
});
