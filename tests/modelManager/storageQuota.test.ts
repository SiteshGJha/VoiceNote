import { storageQuota, StorageQuotaManager } from '@/services/modelManager/storageQuota';
import { InstalledModel } from '@/services/modelManager/catalog';
import { MlError } from '@/ml/errors';

describe('StorageQuotaManager', () => {
  afterEach(() => {
    storageQuota.setMockFreeSpaceBytes(null);
  });

  it('allows download when free storage is >= sizeBytes * 1.2', async () => {
    // 100MB model requires 120MB free
    storageQuota.setMockFreeSpaceBytes(150 * 1024 * 1024);
    await expect(storageQuota.assertSufficientStorage(100 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it('throws STORAGE_FULL when free storage is insufficient', async () => {
    // 100MB model requires 120MB, but only 100MB free
    storageQuota.setMockFreeSpaceBytes(100 * 1024 * 1024);

    await expect(storageQuota.assertSufficientStorage(100 * 1024 * 1024)).rejects.toThrow(
      /Insufficient storage/
    );

    try {
      await storageQuota.assertSufficientStorage(100 * 1024 * 1024);
    } catch (err) {
      expect(err).toBeInstanceOf(MlError);
      if (err instanceof MlError) {
        expect(err.code).toBe('STORAGE_FULL');
      }
    }
  });

  it('computes storage quota summary and quota usage percentage', async () => {
    const quotaManager = new StorageQuotaManager(1000);
    quotaManager.setMockFreeSpaceBytes(5000);

    const info = await quotaManager.getStorageQuotaInfo(500);
    expect(info.usedBytes).toBe(500);
    expect(info.quotaBytes).toBe(1000);
    expect(info.percentUsed).toBe(50);
    expect(info.isQuotaExceeded).toBe(false);
  });

  it('sorts eviction candidates prioritizing non-recommended then oldest models', () => {
    const models: InstalledModel[] = [
      {
        id: 'whisper-base-multilingual', // recommended
        kind: 'asr',
        displayName: 'Base',
        sizeBytes: 150_000_000,
        version: '1.0',
        localPath: '/path/base.gguf',
        installedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'whisper-tiny-multilingual', // not recommended, newer
        kind: 'asr',
        displayName: 'Tiny',
        sizeBytes: 75_000_000,
        version: '1.0',
        localPath: '/path/tiny.gguf',
        installedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'palmer-005', // not recommended, older
        kind: 'slm',
        displayName: 'Palmer',
        sizeBytes: 380_000_000,
        version: '1.0',
        localPath: '/path/palmer.gguf',
        installedAt: '2026-01-15T00:00:00.000Z',
      },
    ];

    const candidates = storageQuota.getEvictionCandidates(models);
    // Non-recommended should come first, ordered by oldest installedAt
    expect(candidates[0]?.id).toBe('palmer-005');
    expect(candidates[1]?.id).toBe('whisper-tiny-multilingual');
    expect(candidates[2]?.id).toBe('whisper-base-multilingual');
  });
});
