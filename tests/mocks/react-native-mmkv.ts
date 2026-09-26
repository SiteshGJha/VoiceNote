/**
 * In-memory MMKV mock for Jest / Node environment.
 * Persists data per storage ID across MMKV re-instantiations.
 */

const storageInstances = new Map<string, Map<string, any>>();

function getStore(id: string = 'default'): Map<string, any> {
  let store = storageInstances.get(id);
  if (!store) {
    store = new Map<string, any>();
    storageInstances.set(id, store);
  }
  return store;
}

export class MMKV {
  public id: string;
  private map: Map<string, any>;

  constructor(configuration?: { id?: string; encryptionKey?: string; path?: string }) {
    this.id = configuration?.id ?? 'default';
    this.map = getStore(this.id);
  }

  set(key: string, value: boolean | string | number | ArrayBuffer): void {
    this.map.set(key, value);
  }

  getString(key: string): string | undefined {
    const val = this.map.get(key);
    return typeof val === 'string' ? val : undefined;
  }

  getNumber(key: string): number | undefined {
    const val = this.map.get(key);
    return typeof val === 'number' ? val : undefined;
  }

  getBoolean(key: string): boolean | undefined {
    const val = this.map.get(key);
    return typeof val === 'boolean' ? val : undefined;
  }

  getBuffer(key: string): ArrayBuffer | undefined {
    const val = this.map.get(key);
    return val instanceof ArrayBuffer ? val : undefined;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clearAll(): void {
    this.map.clear();
  }

  getAllKeys(): string[] {
    return Array.from(this.map.keys());
  }

  contains(key: string): boolean {
    return this.map.has(key);
  }

  recrypt(_newKey?: string): void {
    // No-op for mock
  }

  trim(): void {
    // No-op
  }
}

export default {
  MMKV,
};
