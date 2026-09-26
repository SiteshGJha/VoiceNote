import * as fs from 'fs';
import * as os from 'os';
import { MlError } from '@/ml/errors';
import { InstalledModel, MODEL_CATALOG } from './catalog';
import { logger } from '@/utils/logger';

// 2 GB default model storage budget
export const DEFAULT_MODEL_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
// Free storage headroom multiplier required before downloading (1.2x model size)
export const HEADROOM_MULTIPLIER = 1.2;

export interface StorageQuotaInfo {
  usedBytes: number;
  quotaBytes: number;
  freeDiskBytes: number;
  percentUsed: number;
  isQuotaExceeded: boolean;
}

export class StorageQuotaManager {
  private quotaBytes: number;
  private mockFreeSpaceBytes: number | null = null;

  constructor(quotaBytes = DEFAULT_MODEL_STORAGE_QUOTA_BYTES) {
    this.quotaBytes = quotaBytes;
  }

  public setQuota(quotaBytes: number): void {
    this.quotaBytes = quotaBytes;
  }

  public getQuota(): number {
    return this.quotaBytes;
  }

  /**
   * For unit tests and simulations to verify out-of-storage behaviors.
   */
  public setMockFreeSpaceBytes(bytes: number | null): void {
    this.mockFreeSpaceBytes = bytes;
  }

  /**
   * Retrieves estimated free disk space in bytes.
   */
  public async getAvailableDiskSpaceBytes(): Promise<number> {
    if (this.mockFreeSpaceBytes !== null) {
      return this.mockFreeSpaceBytes;
    }

    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(os.homedir());
        return stats.bavail * stats.bsize;
      }
    } catch (err) {
      logger.warn('StorageQuota', 'Could not query statfs, falling back to estimate', err);
    }

    // Default safe fallback (10 GB) if filesystem query not available
    return 10 * 1024 * 1024 * 1024;
  }

  /**
   * Enforces that free device storage is >= sizeBytes * 1.2.
   * Throws MlError with code STORAGE_FULL if insufficient.
   */
  public async assertSufficientStorage(requiredBytes: number): Promise<void> {
    const freeSpace = await this.getAvailableDiskSpaceBytes();
    const requiredWithHeadroom = Math.ceil(requiredBytes * HEADROOM_MULTIPLIER);

    if (freeSpace < requiredWithHeadroom) {
      const freeMb = Math.round(freeSpace / (1024 * 1024));
      const neededMb = Math.round(requiredWithHeadroom / (1024 * 1024));
      logger.error(
        'StorageQuota',
        `Insufficient storage: ${freeMb}MB free, requires ${neededMb}MB (including 20% headroom)`
      );
      throw new MlError(
        'STORAGE_FULL',
        `Insufficient storage to download model. Requires ${neededMb} MB free (available: ${freeMb} MB).`
      );
    }
  }

  /**
   * Returns storage quota summary.
   */
  public async getStorageQuotaInfo(usedBytes: number): Promise<StorageQuotaInfo> {
    const freeDiskBytes = await this.getAvailableDiskSpaceBytes();
    const percentUsed = this.quotaBytes > 0 ? Math.min(100, (usedBytes / this.quotaBytes) * 100) : 0;
    const isQuotaExceeded = usedBytes > this.quotaBytes;

    return {
      usedBytes,
      quotaBytes: this.quotaBytes,
      freeDiskBytes,
      percentUsed,
      isQuotaExceeded,
    };
  }

  /**
   * Identifies candidate models for eviction (e.g. non-recommended, oldest first).
   */
  public getEvictionCandidates(installedModels: InstalledModel[]): InstalledModel[] {
    const recommendedIds = new Set(
      MODEL_CATALOG.filter((m) => m.recommended).map((m) => m.id)
    );

    // Sort non-recommended first, then by installedAt timestamp ascending (oldest first)
    return [...installedModels].sort((a, b) => {
      const aRec = recommendedIds.has(a.id);
      const bRec = recommendedIds.has(b.id);

      if (aRec !== bRec) {
        return aRec ? 1 : -1; // non-recommended comes first
      }

      return new Date(a.installedAt).getTime() - new Date(b.installedAt).getTime();
    });
  }
}

export const storageQuota = new StorageQuotaManager();
