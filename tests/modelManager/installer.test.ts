import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { modelInstaller } from '@/services/modelManager/installer';
import { modelDownloader } from '@/services/modelManager/downloader';
import { ModelSpec, MODEL_CATALOG } from '@/services/modelManager/catalog';
import { asrModelRegistry } from '@/ml/asr/modelRegistry';

describe('ModelInstallerService Workflows', () => {
  afterEach(() => {
    modelDownloader.setMockPayloadGenerator(null);
  });

  it('lists available models from catalog', () => {
    const available = modelInstaller.listAvailable();
    expect(available.length).toBe(MODEL_CATALOG.length);
    expect(available.some((m) => m.id === 'whisper-base-multilingual')).toBe(true);
  });

  it('tracks installed models and reports total storage usage', () => {
    const installed = modelInstaller.listInstalled();
    expect(installed.length).toBeGreaterThan(0);
    const totalUsage = modelInstaller.getTotalStorageUsageBytes();
    expect(totalUsage).toBeGreaterThan(0);
  });

  it('installs a model, registers in ASR registry, verifies checksum, and removes it cleanly', async () => {
    const payload = Buffer.from('VOICENOTE_MODEL_BLOB_whisper-tiny-multilingual');
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    // Find tiny model in catalog and update mock hash to match payload
    const tinySpec = MODEL_CATALOG.find((m) => m.id === 'whisper-tiny-multilingual');
    expect(tinySpec).toBeDefined();
    if (!tinySpec) return;

    // Set mock generator returning this payload
    const originalHash = tinySpec.sha256;
    (tinySpec as { sha256: string }).sha256 = hash;
    modelDownloader.setMockPayloadGenerator(() => payload);

    try {
      const installed = await modelInstaller.installModel('whisper-tiny-multilingual');
      expect(installed.id).toBe('whisper-tiny-multilingual');
      expect(modelInstaller.isInstalled('whisper-tiny-multilingual')).toBe(true);
      expect(fs.existsSync(installed.localPath)).toBe(true);

      // Verify ASR registry was notified
      expect(asrModelRegistry.getModelById('whisper-tiny-multilingual')?.isInstalled).toBe(true);

      // Run integrity verification on installed model
      const isVerified = await modelInstaller.verify('whisper-tiny-multilingual');
      expect(isVerified).toBe(true);

      // Delete model
      const deleted = await modelInstaller.deleteModel('whisper-tiny-multilingual');
      expect(deleted).toBe(true);
      expect(modelInstaller.isInstalled('whisper-tiny-multilingual')).toBe(false);
      expect(fs.existsSync(installed.localPath)).toBe(false);
      expect(asrModelRegistry.getModelById('whisper-tiny-multilingual')?.isInstalled).toBe(false);
    } finally {
      (tinySpec as { sha256: string }).sha256 = originalHash;
    }
  });

  it('returns false when verifying a non-existent model', async () => {
    const isVerified = await modelInstaller.verify('non-existent-model-id');
    expect(isVerified).toBe(false);
  });
});
