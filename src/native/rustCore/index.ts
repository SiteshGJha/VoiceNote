import { IRustCoreHybridObject } from './types';

export * from './types';

declare const NitroModules: {
  createHybridObject<T>(name: string): T;
} | undefined;

let cachedInstance: IRustCoreHybridObject | null = null;

export function getRustCore(): IRustCoreHybridObject | null {
  if (cachedInstance) return cachedInstance;
  try {
    if (typeof NitroModules !== 'undefined' && typeof NitroModules.createHybridObject === 'function') {
      cachedInstance = NitroModules.createHybridObject<IRustCoreHybridObject>('RustCore');
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
