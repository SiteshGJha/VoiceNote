import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ModelInstallerService } from '@/services/modelManager/installer';
import { MODEL_CATALOG, getModelSpec } from '@/services/modelManager/catalog';
import { nativeAudio } from '@/native/nativeAudio';

describe('ModelInstallerService Reconciliation and Cold-Start Persistence', () => {
  let testModelsDir: string;
  let testManifestPath: string;

  beforeEach(() => {
    testModelsDir = path.join(os.tmpdir(), `vn_test_recon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    testManifestPath = path.join(testModelsDir, 'installed_models.json');
    if (!fs.existsSync(testModelsDir)) {
      fs.mkdirSync(testModelsDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testModelsDir)) {
        fs.rmSync(testModelsDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('Tier 1 Fast Path: loads from pre-seeded physical manifest and verifies matching file sizes', async () => {
    const asrDir = path.join(testModelsDir, 'asr');
    const slmDir = path.join(testModelsDir, 'slm');
    fs.mkdirSync(asrDir, { recursive: true });
    fs.mkdirSync(slmDir, { recursive: true });

    const asrFile = path.join(asrDir, 'whisper-base-multilingual-Q5_1.gguf');
    const slmFile = path.join(slmDir, 'qwen2.5-0.5b-instruct-q4_k_m.gguf');

    const asrBlob = Buffer.from('ASR_MOCK_BLOB_CONTENT_12345');
    const slmBlob = Buffer.from('SLM_MOCK_BLOB_CONTENT_67890');
    fs.writeFileSync(asrFile, asrBlob);
    fs.writeFileSync(slmFile, slmBlob);

    const manifestData = [
      {
        id: 'whisper-base-multilingual',
        kind: 'asr',
        displayName: 'Whisper Base (Multilingual)',
        sizeBytes: asrBlob.length,
        version: '1.0.0',
        localPath: asrFile,
        installedAt: new Date().toISOString(),
      },
      {
        id: 'qwen2.5-0.5b-instruct',
        kind: 'slm',
        displayName: 'Qwen 2.5 0.5B Instruct',
        sizeBytes: slmBlob.length,
        version: '1.0.0',
        localPath: slmFile,
        installedAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(testManifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

    const installer = new ModelInstallerService(testModelsDir);
    await installer.initialize();

    expect(installer.isProvisioned()).toBe(true);
    expect(installer.listInstalled().length).toBe(2);
    expect(installer.isInstalled('whisper-base-multilingual')).toBe(true);
    expect(installer.isInstalled('qwen2.5-0.5b-instruct')).toBe(true);
  });

  it('Tier 2 Deep Reconciliation: automatically recovers from missing manifest by scanning disk and validating checksums', async () => {
    const asrDir = path.join(testModelsDir, 'asr');
    const slmDir = path.join(testModelsDir, 'slm');
    fs.mkdirSync(asrDir, { recursive: true });
    fs.mkdirSync(slmDir, { recursive: true });

    const asrSpec = getModelSpec('whisper-base-multilingual')!;
    const slmSpec = getModelSpec('qwen2.5-0.5b-instruct')!;

    const asrPayload = Buffer.from('REAL_MOCK_ASR_WEIGHTS');
    const slmPayload = Buffer.from('REAL_MOCK_SLM_WEIGHTS');

    const origAsrSha = asrSpec.sha256;
    const origSlmSha = slmSpec.sha256;

    // Temporarily point specs to our test payload hashes
    (asrSpec as any).sha256 = crypto.createHash('sha256').update(asrPayload).digest('hex');
    (slmSpec as any).sha256 = crypto.createHash('sha256').update(slmPayload).digest('hex');

    const asrFile = path.join(asrDir, 'whisper-base-multilingual-Q5_1.gguf');
    const slmFile = path.join(slmDir, 'qwen2.5-0.5b-instruct-q4_k_m.gguf');
    fs.writeFileSync(asrFile, asrPayload);
    fs.writeFileSync(slmFile, slmPayload);

    try {
      // Manifest does NOT exist at testManifestPath
      expect(fs.existsSync(testManifestPath)).toBe(false);

      const installer = new ModelInstallerService(testModelsDir);
      await installer.initialize();

      // Deep reconciliation should have discovered the files, validated hashes, and created manifest
      expect(installer.isProvisioned()).toBe(true);
      expect(installer.listInstalled().length).toBe(2);
      expect(fs.existsSync(testManifestPath)).toBe(true);

      const savedManifest = JSON.parse(fs.readFileSync(testManifestPath, 'utf8'));
      expect(savedManifest.length).toBe(2);
      expect(savedManifest.some((m: any) => m.id === asrSpec.id)).toBe(true);
      expect(savedManifest.some((m: any) => m.id === slmSpec.id)).toBe(true);
    } finally {
      (asrSpec as any).sha256 = origAsrSha;
      (slmSpec as any).sha256 = origSlmSha;
    }
  });

  it('Corrupt File Recovery: omits files failing checksum and flags them as unprovisioned', async () => {
    const asrDir = path.join(testModelsDir, 'asr');
    const slmDir = path.join(testModelsDir, 'slm');
    fs.mkdirSync(asrDir, { recursive: true });
    fs.mkdirSync(slmDir, { recursive: true });

    // Write corrupted file with mismatched checksum
    const corruptAsrFile = path.join(asrDir, 'whisper-base-multilingual-Q5_1.gguf');
    fs.writeFileSync(corruptAsrFile, Buffer.from('CORRUPTED_BYTES'));

    const installer = new ModelInstallerService(testModelsDir);
    await installer.initialize();

    expect(installer.isInstalled('whisper-base-multilingual')).toBe(false);
    expect(installer.isProvisioned()).toBe(false);
    expect(installer.getProvisioningStatus().missingSpecs.some((s) => s.id === 'whisper-base-multilingual')).toBe(true);
  });

  it('Single-Flight Concurrency: concurrent initialize calls share the same promise without duplicating execution', async () => {
    const installer = new ModelInstallerService(testModelsDir);
    const p1 = installer.initialize();
    const p2 = installer.initialize();

    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    expect(installer.isProvisioned()).toBe(false);
  });

  it('Empty Directory Handling: cleanly resolves isProvisioned() === false without throwing', async () => {
    const installer = new ModelInstallerService(testModelsDir);
    await expect(installer.initialize()).resolves.toBeUndefined();
    expect(installer.isProvisioned()).toBe(false);
    expect(installer.listInstalled().length).toBe(0);
  });

  it('Native Audio Bridge File Primitives work correctly with mock fallbacks in test environment', async () => {
    const testFile = path.join(testModelsDir, 'sample.txt');
    const writeOk = await nativeAudio.writeTextFile(testFile, 'Hello VoiceNote macOS');
    expect(writeOk).toBe(true);

    const exists = await nativeAudio.fileExists(testFile);
    expect(exists).toBe(true);

    const size = await nativeAudio.getFileSize(testFile);
    expect(size).toBe(Buffer.byteLength('Hello VoiceNote macOS'));

    const content = await nativeAudio.readTextFile(testFile);
    expect(content).toBe('Hello VoiceNote macOS');

    const missingContent = await nativeAudio.readTextFile(path.join(testModelsDir, 'non_existent.txt'));
    expect(missingContent).toBeNull();

    const missingSize = await nativeAudio.getFileSize(path.join(testModelsDir, 'non_existent.txt'));
    expect(missingSize).toBe(-1);

    const list = await nativeAudio.listDirectory(testModelsDir);
    expect(list).toContain('sample.txt');

    const emptyList = await nativeAudio.listDirectory(path.join(testModelsDir, 'non_existent_dir'));
    expect(emptyList).toEqual([]);
  });
});
