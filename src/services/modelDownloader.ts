/**
 * Canonical model downloader module conforming to Rule 01 / Rule 03:
 * Exactly one category: HTTPS model downloads from user-configured checksum-verified source.
 */
import { modelDownloader, ProgressCallback } from './modelManager/downloader';
import { ModelSpec } from './modelManager/catalog';

export async function downloadModelWithProgress(
  spec: ModelSpec,
  destinationDir: string,
  onProgress?: ProgressCallback
): Promise<string> {
  return modelDownloader.downloadModel(spec, destinationDir, onProgress);
}

export { modelDownloader };
