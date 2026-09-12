import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelDownloader } from '@/services/modelManager/downloader';
import { ModelSpec, MODEL_CATALOG } from '@/services/modelManager/catalog';
import { verifyChecksum } from '@/services/modelManager/verifier';

describe('Model Downloader & Integrity Verifier', () => {
  it('rejects insecure HTTP download URLs per privacy rules', async () => {
    const downloader = new ModelDownloader();
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
      downloader.downloadModel(insecureSpec, path.join(os.tmpdir(), 'models'))
    ).rejects.toThrow('Insecure download rejected');
  });

  it('verifies valid SHA-256 checksums correctly', async () => {
    const tempFile = path.join(os.tmpdir(), `checksum_test_${Date.now()}.txt`);
    const content = 'VoiceNote offline integrity test';
    fs.writeFileSync(tempFile, content);

    // sha256 for "VoiceNote offline integrity test"
    const crypto = require('crypto');
    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

    const isValid = await verifyChecksum(tempFile, expectedHash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyChecksum(tempFile, '0000000000000000000000000000000000000000000000000000000000000000');
    expect(isInvalid).toBe(false);

    fs.unlinkSync(tempFile);
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
