import { AsrModelTier } from '../types';
import { logger } from '@/utils/logger';

export interface AsrModelInfo {
  id: string;
  name: string;
  tier: AsrModelTier;
  quant: string;
  sizeBytes: number;
  filePath: string | null;
  isInstalled: boolean;
}

const DEFAULT_MODELS: Record<AsrModelTier, AsrModelInfo> = {
  fast: {
    id: 'whisper-tiny-multilingual',
    name: 'Whisper Tiny (Multilingual)',
    tier: 'fast',
    quant: 'Q5_1',
    sizeBytes: 78_000_000,
    filePath: null,
    isInstalled: false,
  },
  balanced: {
    id: 'whisper-base-multilingual',
    name: 'Whisper Base (Multilingual)',
    tier: 'balanced',
    quant: 'Q5_1',
    sizeBytes: 148_000_000,
    filePath: null,
    isInstalled: true, // Installed by default after initial setup
  },
  accurate: {
    id: 'whisper-small-multilingual',
    name: 'Whisper Small (Multilingual)',
    tier: 'accurate',
    quant: 'Q4_K_M',
    sizeBytes: 480_000_000,
    filePath: null,
    isInstalled: false,
  },
};

class AsrModelRegistry {
  private models: Map<string, AsrModelInfo> = new Map();

  constructor() {
    for (const [tier, model] of Object.entries(DEFAULT_MODELS)) {
      const instance: AsrModelInfo = { ...model };
      this.models.set(tier, instance);
      this.models.set(model.id, instance);
    }
  }

  public getModelForTier(tier: AsrModelTier): AsrModelInfo | null {
    return this.models.get(tier) ?? null;
  }

  public getModelById(id: string): AsrModelInfo | null {
    return this.models.get(id) ?? null;
  }

  public registerInstalledModel(id: string, localPath: string): void {
    const model = this.models.get(id);
    if (model) {
      model.isInstalled = true;
      model.filePath = localPath;
      logger.info('AsrModelRegistry', `Registered installed model ${id} at ${localPath}`);
    }
  }

  public unregisterModel(id: string): void {
    const model = this.models.get(id);
    if (model) {
      model.isInstalled = false;
      model.filePath = null;
      logger.info('AsrModelRegistry', `Unregistered model ${id}`);
    }
  }

  public listModels(): AsrModelInfo[] {
    const unique = new Map<string, AsrModelInfo>();
    for (const model of this.models.values()) {
      unique.set(model.id, model);
    }
    return Array.from(unique.values());
  }
}

export const asrModelRegistry = new AsrModelRegistry();
