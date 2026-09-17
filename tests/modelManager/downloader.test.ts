import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { modelDownloader } from '@/services/modelManager/downloader';
import { ModelSpec, MODEL_CATALOG } from '@/services/modelManager/catalog';
import { verifyChecksum } from '@/services/modelManager/verifier';
import { storageQuota } from '@/services/modelManager/storageQuota';
import { MlError } from '@/ml/errors';

describe('Model Downloader & Integrity Verifier', () => {
  afterEach(() => {
    storageQuota.setMockFreeSpaceBytes(null);
    modelDownloader.setMockPayloadGenerator(null);
  });

  it('rejects insecure HTTP download URLs per privacy rules', async () => {
    const insecureSpec: ModelSpec = {
      id: 'insecure-model',
      kind: 'asr',
      displayName: 'Insecure Test',
      sizeBytes: 1000,
      version: '1.0',
      url: 'http://insecure.example.com/model.bin', // Insecure HTTP
      sha256: 'abc12345',
      quant: 'int8',
      minRamGb: 1,
    };

    await expect(
      modelDownloader.downloadModel(insecureSpec, path.join(os.tmpdir(), 'models'))
    ).rejects.toThrow('Insecure download rejected');
  });

  it('verifies valid SHA-256 checksums correctly', async () => {
    const tempFile = path.join(os.tmpdir(), `checksum_test_${Date.now()}.txt`);
    const content = 'VoiceNote offline integrity test';
    fs.writeFileSync(tempFile, content);

    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

    const isValid = await verifyChecksum(tempFile, expectedHash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyChecksum(tempFile, '0000000000000000000000000000000000000000000000000000000000000000');
    expect(isInvalid).toBe(false);

    fs.unlinkSync(tempFile);
  });

  it('throws MODEL_CHECKSUM_FAILED and deletes .part file on checksum mismatch', async () => {
    const testDir = path.join(os.tmpdir(), `test_models_${Date.now()}`);
    const badHashSpec: ModelSpec = {
      id: 'bad-hash-model',
      kind: 'asr',
      displayName: 'Bad Hash Test',
      sizeBytes: 4096,
      version: '1.0',
      url: 'https://example.com/model.gguf',
      sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      quant: 'int8',
      minRamGb: 1,
    };

    modelDownloader.setMockPayloadGenerator(() => Buffer.from('CORRUPTED_PAYLOAD_DATA'));

    await expect(modelDownloader.downloadModel(badHashSpec, testDir)).rejects.toThrow(
      /Checksum failed/
    );

    // Verify .part file was deleted
    const partPath = path.join(os.tmpdir(), `${badHashSpec.id}.part`);
    expect(fs.existsSync(partPath)).toBe(false);

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('downloads, verifies checksum, and saves verified model', async () => {
    const testDir = path.join(os.tmpdir(), `test_models_${Date.now()}`);
    const payload = Buffer.from('VALID_MODEL_WEIGHTS_CONTENT');
    const validHash = crypto.createHash('sha256').update(payload).digest('hex');

    const goodSpec: ModelSpec = {
      id: 'valid-test-model',
      kind: 'slm',
      displayName: 'Valid Test',
      sizeBytes: payload.length,
      version: '1.0',
      url: 'https://example.com/valid-model.gguf',
      sha256: validHash,
      quant: 'Q4_K_M',
      minRamGb: 2,
    };

    modelDownloader.setMockPayloadGenerator(() => payload);

    const progressReports: number[] = [];
    const finalPath = await modelDownloader.downloadModel(goodSpec, testDir, (pct) => {
      progressReports.push(pct);
    });

    expect(fs.existsSync(finalPath)).toBe(true);
    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1]).toBe(100);

    // Verify written content matches payload
    const written = fs.readFileSync(finalPath);
    expect(written.equals(payload)).toBe(true);

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('contains required Whisper Base and Qwen2.5 models in catalog', () => {
    const asrBase = MODEL_CATALOG.find((m) => m.id === 'whisper-base-multilingual');
    expect(asrBase).toBeDefined();
    expect(asrBase?.url.startsWith('https://')).toBe(true);
    expect(asrBase?.sha256).toBeTruthy();

    const slmDefault = MODEL_CATALOG.find((m) => m.id === 'qwen2.5-0.5b-instruct');
    expect(slmDefault).toBeDefined();
    expect(slmDefault?.url.startsWith('https://')).toBe(true);
  });
});
