import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InstalledModel, ModelSpec, MODEL_CATALOG, getModelSpec, getModelDestinationSubdir } from './catalog';
import { modelDownloader, ProgressCallback } from './downloader';
import { verifyChecksum } from './verifier';
import { asrModelRegistry } from '@/ml/asr/modelRegistry';
import { slmModelRegistry } from '@/ml/slm/modelRegistry';
import { logger } from '@/utils/logger';

class ModelInstallerService {
  private installedModels: Map<string, InstalledModel> = new Map();
  private modelsDir: string;
  private manifestPath: string;

  constructor() {
    this.modelsDir = path.join(os.homedir(), '.voicenote', 'models');
    this.manifestPath = path.join(this.modelsDir, 'installed_models.json');
    this.initializeFromStorage();
  }

  private initializeFromStorage(): void {
    // 1. Ensure root models directory exists
    try {
      if (!fs.existsSync(this.modelsDir)) {
        fs.mkdirSync(this.modelsDir, { recursive: true });
      }
    } catch (err) {
      logger.warn('ModelInstaller', 'Could not create models directory on startup', err);
    }

    // 2. Load persisted manifest if present, pruning phantom entries whose files do not exist
    if (fs.existsSync(this.manifestPath)) {
      try {
        const raw = fs.readFileSync(this.manifestPath, 'utf8');
        const list: InstalledModel[] = JSON.parse(raw);
        let prunedAny = false;
        for (const item of list) {
          if (fs.existsSync(item.localPath)) {
            this.installedModels.set(item.id, item);
            if (item.kind === 'asr') {
              asrModelRegistry.registerInstalledModel(item.id, item.localPath);
            } else if (item.kind === 'slm') {
              slmModelRegistry.registerInstalledModel(item.id, item.localPath);
            }
          } else {
            prunedAny = true;
            logger.info('ModelInstaller', `Pruned phantom installed model ${item.id}: file not found at ${item.localPath}`);
          }
        }
        if (prunedAny) {
          this.persistManifest();
        }
      } catch (err) {
        logger.warn('ModelInstaller', 'Failed to read installed models manifest', err);
      }
    }

    // 3. In automated test environment only: seed mock test models so test fixtures have fixture data
    if (process.env.NODE_ENV === 'test') {
      const baseSpec = getModelSpec('whisper-base-multilingual');
      if (baseSpec && !this.installedModels.has(baseSpec.id)) {
        const asrDir = path.join(this.modelsDir, 'asr');
        if (!fs.existsSync(asrDir)) {
          fs.mkdirSync(asrDir, { recursive: true });
        }
        const defaultPath = path.join(asrDir, `${baseSpec.id}.gguf`);
        if (!fs.existsSync(defaultPath)) {
          fs.writeFileSync(defaultPath, Buffer.from(`TEST_MODEL_${baseSpec.id}`));
        }
        this.installedModels.set(baseSpec.id, {
          id: baseSpec.id,
          kind: baseSpec.kind,
          displayName: baseSpec.displayName,
          sizeBytes: baseSpec.sizeBytes,
          version: baseSpec.version,
          localPath: defaultPath,
          installedAt: new Date().toISOString(),
        });
        asrModelRegistry.registerInstalledModel(baseSpec.id, defaultPath);
      }

      const defaultSlmSpec = getModelSpec('qwen2.5-0.5b-instruct');
      if (defaultSlmSpec && !this.installedModels.has(defaultSlmSpec.id)) {
        const slmDir = path.join(this.modelsDir, 'slm');
        if (!fs.existsSync(slmDir)) {
          fs.mkdirSync(slmDir, { recursive: true });
        }
        const defaultSlmPath = path.join(slmDir, `${defaultSlmSpec.id}-${defaultSlmSpec.quant}.gguf`);
        if (!fs.existsSync(defaultSlmPath)) {
          fs.writeFileSync(defaultSlmPath, Buffer.from(`TEST_MODEL_${defaultSlmSpec.id}`));
        }
        this.installedModels.set(defaultSlmSpec.id, {
          id: defaultSlmSpec.id,
          kind: defaultSlmSpec.kind,
          displayName: defaultSlmSpec.displayName,
          sizeBytes: defaultSlmSpec.sizeBytes,
          version: defaultSlmSpec.version,
          localPath: defaultSlmPath,
          installedAt: new Date().toISOString(),
        });
        slmModelRegistry.registerInstalledModel(defaultSlmSpec.id, defaultSlmPath);
      }
    }
  }

  private persistManifest(): void {
    try {
      const dir = path.dirname(this.manifestPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.installedModels.values()), null, 2);
      fs.writeFileSync(this.manifestPath, data, 'utf8');
    } catch (err) {
      logger.warn('ModelInstaller', 'Failed to persist installed models manifest', err);
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

  /**
   * Public convenience method matching SKILL.md: download(id, onProgress)
   */
  public async download(id: string, onProgress?: (pct: number) => void): Promise<void> {
    await this.installModel(id, onProgress ? (pct) => onProgress(pct) : undefined);
  }

  /**
   * Downloads, verifies, and registers a model specification.
   */
  public async installModel(id: string, onProgress?: ProgressCallback): Promise<InstalledModel> {
    const spec = getModelSpec(id);
    if (!spec) {
      throw new Error(`Model specification not found for ID: ${id}`);
    }

    const subDirName = getModelDestinationSubdir(spec.kind);
    const targetDir = path.join(this.modelsDir, subDirName);
    const localPath = await modelDownloader.downloadModel(spec, targetDir, onProgress);

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
    this.persistManifest();

    if (spec.kind === 'asr') {
      asrModelRegistry.registerInstalledModel(spec.id, localPath);
    } else if (spec.kind === 'slm') {
      slmModelRegistry.registerInstalledModel(spec.id, localPath);
    }

    logger.info('ModelInstaller', `Model ${spec.id} registered and ready`);
    return installed;
  }

  /**
   * Public convenience method matching SKILL.md: remove(id)
   */
  public async remove(id: string): Promise<void> {
    await this.deleteModel(id);
  }

  /**
   * Uninstalls model from filesystem, unregisters from runtime engines, and removes from manifest.
   */
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
      this.persistManifest();

      if (model.kind === 'asr') {
        asrModelRegistry.unregisterModel(id);
      } else if (model.kind === 'slm') {
        slmModelRegistry.unregisterModel(id);
      }

      logger.info('ModelInstaller', `Model ${id} deleted successfully`);
      return true;
    } catch (err) {
      logger.error('ModelInstaller', `Failed to delete model file: ${model.localPath}`, err);
      return false;
    }
  }

  /**
   * Verifies SHA-256 integrity of an installed model file against the catalog.
   */
  public async verify(id: string): Promise<boolean> {
    const model = this.installedModels.get(id);
    const spec = getModelSpec(id);
    if (!model || !spec) {
      logger.warn('ModelInstaller', `Cannot verify model ${id}: not found in installed records or catalog`);
      return false;
    }

    if (!fs.existsSync(model.localPath)) {
      logger.warn('ModelInstaller', `Model file does not exist on disk: ${model.localPath}`);
      return false;
    }

    return verifyChecksum(model.localPath, spec.sha256);
  }
}

export const modelInstaller = new ModelInstallerService();
