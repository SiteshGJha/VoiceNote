import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InstalledModel, ModelSpec, MODEL_CATALOG } from './catalog';
import { modelDownloader, ProgressCallback } from './downloader';
import { asrModelRegistry } from '@/ml/asr/modelRegistry';
import { logger } from '@/utils/logger';

class ModelInstallerService {
  private installedModels: Map<string, InstalledModel> = new Map();
  private modelsDir: string;

  constructor() {
    this.modelsDir = path.join(os.homedir(), '.voicenote', 'models');
    // Pre-populate with default installed base model
    const baseSpec = MODEL_CATALOG.find((m) => m.id === 'whisper-base-multilingual');
    if (baseSpec) {
      this.installedModels.set(baseSpec.id, {
        id: baseSpec.id,
        kind: baseSpec.kind,
        displayName: baseSpec.displayName,
        sizeBytes: baseSpec.sizeBytes,
        version: baseSpec.version,
        localPath: path.join(this.modelsDir, 'asr', `${baseSpec.id}.gguf`),
        installedAt: new Date().toISOString(),
      });
    }
  }

  public getModelsDirectory(): string {
    return this.modelsDir;
  }

  public listAvailable(): ModelSpec[] {
    return [...MODEL_CATALOG];
  }

  public listInstalled(): InstalledModel[] {
    return Array.from(this.installedModels.values());
  }

  public isInstalled(id: string): boolean {
    return this.installedModels.has(id);
  }

  public getTotalStorageUsageBytes(): number {
    let total = 0;
    for (const model of this.installedModels.values()) {
      total += model.sizeBytes;
    }
    return total;
  }

  public async installModel(id: string, onProgress?: ProgressCallback): Promise<InstalledModel> {
    const spec = MODEL_CATALOG.find((m) => m.id === id);
    if (!spec) {
      throw new Error(`Model specification not found for ID: ${id}`);
    }

    const subDir = path.join(this.modelsDir, spec.kind);
    const localPath = await modelDownloader.downloadModel(spec, subDir, onProgress);

    const installed: InstalledModel = {
      id: spec.id,
      kind: spec.kind,
      displayName: spec.displayName,
      sizeBytes: spec.sizeBytes,
      version: spec.version,
      localPath,
      installedAt: new Date().toISOString(),
    };

    this.installedModels.set(spec.id, installed);

    if (spec.kind === 'asr') {
      asrModelRegistry.registerInstalledModel(spec.id, localPath);
    }

    logger.info('ModelInstaller', `Model ${spec.id} registered and ready`);
    return installed;
  }

  public async deleteModel(id: string): Promise<boolean> {
    const model = this.installedModels.get(id);
    if (!model) {
      return false;
    }

    try {
      if (fs.existsSync(model.localPath)) {
        fs.unlinkSync(model.localPath);
      }
      this.installedModels.delete(id);

      if (model.kind === 'asr') {
        asrModelRegistry.unregisterModel(id);
      }

      logger.info('ModelInstaller', `Model ${id} deleted successfully`);
      return true;
    } catch (err) {
      logger.error('ModelInstaller', `Failed to delete model file: ${model.localPath}`, err);
      return false;
    }
  }
}

export const modelInstaller = new ModelInstallerService();
