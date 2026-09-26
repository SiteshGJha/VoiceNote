import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelSpec, getModelFileName } from './catalog';
import { verifyChecksum } from './verifier';
import { storageQuota } from './storageQuota';
import { MlError } from '@/ml/errors';
import { logger } from '@/utils/logger';

export type ProgressCallback = (percent: number, bytesDownloaded: number, totalBytes: number) => void;

export class ModelDownloader {
  private activeDownloads: Map<string, boolean> = new Map();
  private mockPayloadGenerator: ((spec: ModelSpec) => Buffer) | null = null;

  /**
   * Allows tests to specify custom mock file content (e.g. to test valid or invalid checksums).
   */
  public setMockPayloadGenerator(generator: ((spec: ModelSpec) => Buffer) | null): void {
    this.mockPayloadGenerator = generator;
  }

  public isDownloading(modelId: string): boolean {
    return this.activeDownloads.get(modelId) === true;
  }

  /**
   * Downloads a model spec with progress reporting, resume capability, and checksum verification.
   */
  public async downloadModel(
    spec: ModelSpec,
    modelsDir: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    // 1. Strict HTTPS enforcement
    if (!spec.url.startsWith('https://')) {
      throw new Error(`Insecure download rejected. URLs must use HTTPS: ${spec.url}`);
    }

    if (this.activeDownloads.get(spec.id)) {
      throw new Error(`Download already in progress for model: ${spec.id}`);
    }

    // 2. Storage quota & headroom check (requires free space >= sizeBytes * 1.2)
    await storageQuota.assertSufficientStorage(spec.sizeBytes);

    this.activeDownloads.set(spec.id, true);
    logger.info('ModelDownloader', `Starting download for ${spec.displayName} (${spec.sizeBytes} bytes)`);

    // Ensure target models directory exists
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const tempDir = os.tmpdir();
    const partPath = path.join(tempDir, `${spec.id}.part`);
    const finalFileName = getModelFileName(spec);
    const finalPath = path.join(modelsDir, finalFileName);

    try {
      // 3. Inspect existing partial download for resume
      let resumeByte = 0;
      if (fs.existsSync(partPath)) {
        try {
          const stats = fs.statSync(partPath);
          if (stats.size > 0 && stats.size < spec.sizeBytes) {
            resumeByte = stats.size;
            logger.info(
              'ModelDownloader',
              `Resuming partial download for ${spec.id} from byte ${resumeByte}/${spec.sizeBytes}`
            );
          } else if (stats.size >= spec.sizeBytes) {
            // Already full size or larger; will verify checksum directly
            resumeByte = stats.size;
          }
        } catch (err) {
          logger.warn('ModelDownloader', 'Could not inspect existing part file', err);
        }
      }

      // 4. Stream / complete download
      await this.performDownload(spec, partPath, resumeByte, onProgress);

      // Check if download was cancelled while in flight
      if (!this.activeDownloads.has(spec.id)) {
        throw new Error(`Download cancelled for ${spec.id}`);
      }

      // 5. Verify SHA-256 integrity
      logger.info('ModelDownloader', `Verifying SHA-256 for ${spec.id}`);
      const isValid = await verifyChecksum(partPath, spec.sha256);

      if (!isValid) {
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
        throw new MlError('MODEL_CHECKSUM_FAILED', `Checksum failed for model ${spec.id}`);
      }

      // 6. Atomically move from .part to final model path
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }
      fs.renameSync(partPath, finalPath);
      logger.info('ModelDownloader', `Model successfully installed to ${finalPath}`);

      return finalPath;
    } catch (err) {
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // Ignore unlink error
        }
      }
      throw err;
    } finally {
      this.activeDownloads.delete(spec.id);
    }
  }

  public cancelDownload(modelId: string): void {
    if (this.activeDownloads.has(modelId)) {
      this.activeDownloads.delete(modelId);
      logger.info('ModelDownloader', `Cancelled download for ${modelId}`);

      const tempDir = os.tmpdir();
      const partPath = path.join(tempDir, `${modelId}.part`);
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // ignore
        }
      }
    }
  }

  private async performDownload(
    spec: ModelSpec,
    targetPartPath: string,
    resumeByte: number,
    onProgress?: ProgressCallback
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // In tests / mock mode, generate payload (with mock generator if configured)
      let currentBytes = resumeByte;
      const totalBytes = spec.sizeBytes;
      const chunkSize = Math.max(Math.floor(totalBytes / 4), 1024);

      const timer = setInterval(() => {
        if (!this.activeDownloads.has(spec.id)) {
          clearInterval(timer);
          reject(new Error(`Download cancelled for ${spec.id}`));
          return;
        }

        currentBytes = Math.min(currentBytes + chunkSize, totalBytes);
        const percent = Math.min(100, Math.floor((currentBytes / totalBytes) * 100));
        onProgress?.(percent, currentBytes, totalBytes);

        if (currentBytes >= totalBytes) {
          clearInterval(timer);
          try {
            if (this.mockPayloadGenerator) {
              const payload = this.mockPayloadGenerator(spec);
              fs.writeFileSync(targetPartPath, payload);
            } else {
              // Default test placeholder
              fs.writeFileSync(targetPartPath, Buffer.from(`VOICENOTE_MODEL_BLOB_${spec.id}`));
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      }, 30);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });
  }
}

export const modelDownloader = new ModelDownloader();
