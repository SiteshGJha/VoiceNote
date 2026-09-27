import { MMKV } from 'react-native-mmkv';
import { HistoryRecordInput, TranscriptionRecord } from './types';
import { getOrCreateStorageKey } from './keychain';
import { logger } from '@/utils/logger';

export const MAX_HISTORY_RECORDS = 50;

class HistoryStorageService {
  private storage: MMKV | null = null;
  private records: TranscriptionRecord[] = [];
  private isInitialized = false;

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    // Obtain encryption key from Keychain
    const key = await getOrCreateStorageKey();
    try {
      this.storage = new MMKV({ id: 'voicenote-history', encryptionKey: key });
      try {
        const raw = this.storage.getString('records');
        this.records = raw ? (JSON.parse(raw) as TranscriptionRecord[]) : [];
      } catch (err) {
        logger.error('HistoryStorage', 'Failed to parse records from MMKV', err);
        this.records = [];
      }
      logger.info('HistoryStorage', `Storage initialized with key length: ${key.length}, loaded ${this.records.length} records`);
    } catch (err) {
      logger.warn('HistoryStorage', 'Native MMKV initialization failed, falling back to in-memory storage', err);
      this.storage = null;
      this.records = [];
    }
    this.isInitialized = true;
  }

  /**
   * Adds a new transcription record, enforcing FIFO eviction at 50 records.
   */
  public async addRecord(input: HistoryRecordInput): Promise<TranscriptionRecord> {
    await this.initialize();

    const record: TranscriptionRecord = {
      id: `vn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...input,
    };

    // Prepend to maintain newest first
    this.records.unshift(record);

    // Strict FIFO eviction: drop oldest records beyond 50
    if (this.records.length > MAX_HISTORY_RECORDS) {
      const evictedCount = this.records.length - MAX_HISTORY_RECORDS;
      this.records = this.records.slice(0, MAX_HISTORY_RECORDS);
      logger.info('HistoryStorage', `Evicted ${evictedCount} oldest records to respect 50-item cap`);
    }

    this.storage?.set('records', JSON.stringify(this.records));
    logger.info('HistoryStorage', `Saved record ${record.id}. Total items: ${this.records.length}`);
    return record;
  }

  public async listRecords(): Promise<TranscriptionRecord[]> {
    await this.initialize();
    return [...this.records];
  }

  public async getRecord(id: string): Promise<TranscriptionRecord | null> {
    await this.initialize();
    return this.records.find((r) => r.id === id) ?? null;
  }

  public async deleteRecord(id: string): Promise<boolean> {
    await this.initialize();
    const prevLength = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    const deleted = this.records.length < prevLength;
    if (deleted) {
      this.storage?.set('records', JSON.stringify(this.records));
      logger.info('HistoryStorage', `Deleted record ${id}. Remaining: ${this.records.length}`);
    }
    return deleted;
  }

  public async clearAll(): Promise<void> {
    await this.initialize();
    const count = this.records.length;
    this.records = [];
    this.storage?.set('records', JSON.stringify(this.records));
    logger.info('HistoryStorage', `Cleared all ${count} history records`);
  }
}

export const historyStorage = new HistoryStorageService();
