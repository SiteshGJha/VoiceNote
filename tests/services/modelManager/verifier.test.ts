import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { verifyChecksum } from '@/services/modelManager/verifier';
import { getRustCore, __setRustCoreInstance } from '@/native/rustCore';

describe('ModelVerifier', () => {
  let tempFilePath: string;
  const content = 'voicenote-offline-ml';
  // echo -n "voicenote-offline-ml" | shasum -a 256
  const expectedHash = 'd9407f8adb3d2208d2d36ff8bb46971ec142bcd1ca84f28ea9542a3ad3c4ff4f';

  beforeEach(() => {
    tempFilePath = path.join(os.tmpdir(), `test_verifier_${Date.now()}_${Math.random().toString(36).substring(7)}.bin`);
    fs.writeFileSync(tempFilePath, content);
  });

  afterEach(() => {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // ignore
      }
    }
    __setRustCoreInstance(null);
  });

  it('verifies valid file checksum matches expected sha256', async () => {
    const result = await verifyChecksum(tempFilePath, expectedHash);
    expect(result).toBe(true);
  });

  it('verifies valid file checksum case-insensitively', async () => {
    const result = await verifyChecksum(tempFilePath, expectedHash.toUpperCase());
    expect(result).toBe(true);
  });

  it('returns false on checksum mismatch', async () => {
    const result = await verifyChecksum(tempFilePath, 'deadbeef00000000000000000000000000000000000000000000000000000000');
    expect(result).toBe(false);
  });

  it('returns false for non-existent file', async () => {
    const result = await verifyChecksum('/nonexistent/path/model.bin', expectedHash);
    expect(result).toBe(false);
  });

  it('delegates to getRustCore().verifyFileSha256 when available', async () => {
    const mockVerify = jest.fn().mockReturnValue(true);
    __setRustCoreInstance({
      verifyFileSha256: mockVerify,
    });

    const result = await verifyChecksum(tempFilePath, expectedHash);
    expect(result).toBe(true);
    expect(mockVerify).toHaveBeenCalledWith(tempFilePath, expectedHash);
  });

  it('falls back to stream verification if Rust core throws', async () => {
    __setRustCoreInstance({
      verifyFileSha256: () => {
        throw new Error('Rust panic or bridge failure');
      },
    });

    const result = await verifyChecksum(tempFilePath, expectedHash);
    expect(result).toBe(true);
  });

  it('falls back to nativeAudio.verifyFileChecksum if mock Rust core returns false', async () => {
    const { nativeAudio } = require('@/native/nativeAudio');
    const origAvailable = nativeAudio.isNativeAvailable;
    const origVerify = nativeAudio.verifyFileChecksum;

    try {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: true, configurable: true });
      nativeAudio.verifyFileChecksum = jest.fn().mockResolvedValue(true);

      __setRustCoreInstance({
        getVersion: () => '0.1.0-mock',
        verifyFileSha256: () => false, // mock returns false because it cannot read native file
      });

      const result = await verifyChecksum(tempFilePath, expectedHash);
      expect(result).toBe(true);
      expect(nativeAudio.verifyFileChecksum).toHaveBeenCalledWith(tempFilePath, expectedHash);
    } finally {
      Object.defineProperty(nativeAudio, 'isNativeAvailable', { value: origAvailable, configurable: true });
      nativeAudio.verifyFileChecksum = origVerify;
    }
  });
});
