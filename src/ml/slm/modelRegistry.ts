import { logger } from '@/utils/logger';

export interface SlmModelInfo {
  id: string;
  name: string;
  quant: string;
  sizeBytes: number;
  filePath: string | null;
  isInstalled: boolean;
}

const DEFAULT_SLM_MODELS: Record<string, SlmModelInfo> = {
  'qwen2.5-0.5b-instruct': {
    id: 'qwen2.5-0.5b-instruct',
    name: 'Qwen 2.5 (0.5B Instruct)',
    quant: 'Q4_K_M',
    sizeBytes: 350_000_000,
    filePath: '/models/slm/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    isInstalled: true,
  },
  'palmer-005': {
    id: 'palmer-005',
    name: 'Palmer-005 (0.5B Rewrite)',
    quant: 'Q4_K_M',
    sizeBytes: 380_000_000,
    filePath: null,
    isInstalled: false,
  },
};

class SlmModelRegistry {
  private models: Map<string, SlmModelInfo> = new Map();
  private activeModelId: string = 'qwen2.5-0.5b-instruct';

  constructor() {
    for (const [id, model] of Object.entries(DEFAULT_SLM_MODELS)) {
      this.models.set(id, { ...model });
    }
  }

  public getActiveModelId(): string {
    return this.activeModelId;
  }

  public setActiveModelId(id: string): void {
    if (!this.models.has(id)) {
      throw new Error(`SLM Model ${id} not found in registry`);
    }
    this.activeModelId = id;
    logger.info('SlmModelRegistry', `Active SLM model set to ${id}`);
  }

  public getModelById(id: string): SlmModelInfo | null {
    return this.models.get(id) ?? null;
  }

  public getActiveModel(): SlmModelInfo {
    const active = this.models.get(this.activeModelId);
    if (active) {
      return active;
    }
    const fallback = DEFAULT_SLM_MODELS['qwen2.5-0.5b-instruct'];
    if (fallback) {
      return fallback;
    }
    throw new Error('Default SLM model not configured');
  }

  public registerInstalledModel(id: string, filePath: string): void {
    const existing = this.models.get(id);
    if (existing) {
      existing.filePath = filePath;
      existing.isInstalled = true;
    } else {
      this.models.set(id, {
        id,
        name: id,
        quant: 'Q4_K_M',
        sizeBytes: 0,
        filePath,
        isInstalled: true,
      });
    }
    logger.info('SlmModelRegistry', `Registered installed SLM model ${id} at ${filePath}`);
  }

  public unregisterModel(id: string): void {
    const existing = this.models.get(id);
    if (existing) {
      existing.isInstalled = false;
      existing.filePath = null;
    }
    logger.info('SlmModelRegistry', `Unregistered SLM model ${id}`);
  }

  public listInstalled(): SlmModelInfo[] {
    return Array.from(this.models.values()).filter((m) => m.isInstalled);
  }
}

export const slmModelRegistry = new SlmModelRegistry();
