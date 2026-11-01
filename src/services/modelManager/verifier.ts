import * as crypto from 'crypto';
import * as fs from 'fs';
import { logger } from '@/utils/logger';
import { nativeAudio } from '@/native/nativeAudio';
import { getRustCore } from '@/native/rustCore';

/**
 * Computes SHA-256 checksum of a local file.
 */
export async function verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    logger.error('ModelVerifier', `File does not exist for verification: ${filePath}`);
    return false;
  }

  // 1. Fast Rust core streaming SHA-256 verifier via ring
  try {
    const rustCore = getRustCore();
    if (rustCore && typeof rustCore.verifyFileSha256 === 'function') {
      const match = rustCore.verifyFileSha256(filePath, expectedSha256);
      if (!match) {
        logger.warn(
          'ModelVerifier',
          `Checksum mismatch for ${filePath}. Expected: ${expectedSha256}`
        );
      } else {
        logger.info('ModelVerifier', `Checksum verified successfully for ${filePath}`);
      }
      return match;
    }
  } catch (err) {
    logger.warn('ModelVerifier', 'Rust core checksum verification failed, falling back to stream', err);
  }

  // 2. Legacy native accelerated CommonCrypto on device if available
  if (nativeAudio.isNativeAvailable) {
    try {
      const nativeResult = await nativeAudio.verifyFileChecksum(filePath, expectedSha256);
      if (typeof nativeResult === 'boolean') {
        return nativeResult;
      }
    } catch (err) {
      logger.warn('ModelVerifier', 'Native checksum verification failed, falling back to JS stream', err);
    }
  }

  // 3. Fallback to JS stream
  return new Promise<boolean>((resolve) => {
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const actualSha256 = hash.digest('hex').toLowerCase();
        const matches = actualSha256 === expectedSha256.toLowerCase();
        if (!matches) {
          logger.warn(
            'ModelVerifier',
            `Checksum mismatch for ${filePath}. Expected: ${expectedSha256}, Actual: ${actualSha256}`
          );
        } else {
          logger.info('ModelVerifier', `Checksum verified successfully for ${filePath}`);
        }
        resolve(matches);
      });
      stream.on('error', (err) => {
        logger.error('ModelVerifier', 'Error reading file during checksum calculation', err);
        resolve(false);
      });
    } catch (err) {
      logger.error('ModelVerifier', 'Exception in checksum verification', err);
      resolve(false);
    }
  });
}
