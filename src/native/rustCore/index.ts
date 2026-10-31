import { IRustCoreHybridObject } from './types';

export * from './types';

interface NitroProvider {
  createHybridObject<T>(name: string): T;
}

interface GlobalWithNitro {
  NitroModules?: NitroProvider;
  NitroModulesProxy?: NitroProvider;
}

let cachedInstance: IRustCoreHybridObject | null = null;

export function getRustCore(): IRustCoreHybridObject | null {
  if (cachedInstance) return cachedInstance;
  try {
    const globalContext = globalThis as unknown as GlobalWithNitro;
    const provider = globalContext.NitroModulesProxy ?? globalContext.NitroModules;
    if (provider && typeof provider.createHybridObject === 'function') {
      cachedInstance = provider.createHybridObject<IRustCoreHybridObject>('RustCore');
      return cachedInstance;
    }
  } catch {
    // In Node / Jest / Simulator environments without native Nitro compiled
  }
  return {
    getVersion: () => '0.1.0-mock',
  };
}

/**
 * Used for testing to reset or set a mock instance
 */
export function __setRustCoreInstance(instance: IRustCoreHybridObject | null): void {
  cachedInstance = instance;
}
