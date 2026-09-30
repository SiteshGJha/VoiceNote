import { historyStorage, MAX_HISTORY_RECORDS } from '@/services/history';
import * as mmkvModule from 'react-native-mmkv';

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

  it('enforces strict FIFO eviction at 500 records', async () => {
    expect(MAX_HISTORY_RECORDS).toBe(500);

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
    expect(records.length).toBe(500);
    expect(records[0]?.rawText).toBe('Raw note number 505');
    const oldestRecord = records[records.length - 1];
    expect(oldestRecord?.rawText).toBe('Raw note number 6');
  });

  it('automatically calculates wordCount and sets schema version _v: 2 on addRecord', async () => {
    const record = await historyStorage.addRecord({
      rawText: 'This is a quick test of the emergency broadcast system',
      finalText: 'This is a quick test of the emergency broadcast system.',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 3000,
      processingDurationMs: 400,
    });

    expect(record.wordCount).toBe(10);
    expect(record._v).toBe(2);
  });

  it('backfills wordCount and _v on legacy v1 records during initialization', async () => {
    const legacyRecord = {
      id: 'legacy_1',
      timestamp: new Date().toISOString(),
      rawText: 'hello world',
      finalText: 'Hello world from yesterday.',
      tone: 'casual',
      lang: 'en',
      audioDurationMs: 1200,
      processingDurationMs: 200,
      // Notice: _v and wordCount are missing
    };

    const storageInstance = (historyStorage as any).storage;
    storageInstance.set('records', JSON.stringify([legacyRecord]));

    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const records = await historyStorage.listRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.wordCount).toBe(4);
    expect(records[0]?._v).toBe(2);
  });

  it('supports querying records by date range using getDateRange', async () => {
    const t0 = 1700000000000;
    const r1 = await historyStorage.addRecord({
      rawText: 'One',
      finalText: 'One note.',
      tone: 'professional',
      lang: 'en',
      audioDurationMs: 1000,
      processingDurationMs: 100,
    });
    // Manually adjust timestamp for deterministic range test
    r1.timestamp = new Date(t0).toISOString();
    const storageInstance = (historyStorage as any).storage;
    storageInstance.set('records', JSON.stringify([r1]));
    (historyStorage as any).records = [r1];

    const inRange = await historyStorage.getDateRange(t0 - 1000, t0 + 1000);
    expect(inRange).toHaveLength(1);
    expect(inRange[0]?.id).toBe(r1.id);

    const outOfRange = await historyStorage.getDateRange(t0 + 5000, t0 + 10000);
    expect(outOfRange).toHaveLength(0);
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

  it('falls back gracefully to in-memory storage if MMKV instantiation throws', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset service state to force re-initialization
    (historyStorage as any).storage = null;
    (historyStorage as any).records = [];
    (historyStorage as any).isInitialized = false;

    const mmkvSpy = jest.spyOn(mmkvModule, 'MMKV').mockImplementation(() => {
      throw new Error('Native MMKV initialization failed');
    });

    try {
      const record = await historyStorage.addRecord({
        rawText: 'Fallback note',
        finalText: 'Fallback note.',
        tone: 'casual',
        lang: 'en',
        audioDurationMs: 1500,
        processingDurationMs: 250,
      });

      expect(record.rawText).toBe('Fallback note');
      expect((historyStorage as any).storage).toBeNull();

      const records = await historyStorage.listRecords();
      expect(records).toHaveLength(1);
      expect(records[0]?.rawText).toBe('Fallback note');

      const deleted = await historyStorage.deleteRecord(record.id);
      expect(deleted).toBe(true);

      const afterDelete = await historyStorage.listRecords();
      expect(afterDelete).toHaveLength(0);

      await historyStorage.addRecord({
        rawText: 'Note to clear',
        finalText: 'Note to clear.',
        tone: 'casual',
        lang: 'en',
        audioDurationMs: 1000,
        processingDurationMs: 100,
      });
      await historyStorage.clearAll();
      const afterClear = await historyStorage.listRecords();
      expect(afterClear).toHaveLength(0);
    } finally {
      mmkvSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      // Reset service state so subsequent tests can re-initialize properly
      (historyStorage as any).storage = null;
      (historyStorage as any).records = [];
      (historyStorage as any).isInitialized = false;
    }
  });
});
