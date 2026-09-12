import * as crypto from 'crypto';
import * as fs from 'fs';
import { logger } from '@/utils/logger';

/**
 * Computes SHA-256 checksum of a local file.
 */
export async function verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!fs.existsSync(filePath)) {
      logger.error('ModelVerifier', `File does not exist for verification: ${filePath}`);
      resolve(false);
      return;
    }

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
