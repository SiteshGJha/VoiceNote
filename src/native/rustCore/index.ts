import * as fs from 'fs';
import { IRustCoreHybridObject } from './types';
import { trimSilence } from '@/audio/silenceTrim';
import { wrapPcmWithWavHeader } from '@/audio/wavUtils';

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
  cachedInstance = {
    getVersion: () => '0.1.0-mock',
    trimAndSaveWav: (pcm: ArrayBuffer, outputPath: string, paddingMs: number = 200) => {
      const uint8 = new Uint8Array(pcm);
      const trimResult = trimSilence(uint8, { paddingMs, frameMs: 30 });
      if (!trimResult.hasSpeech) {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        return { hasSpeech: false, status: 0 };
      }
      const wavBytes = wrapPcmWithWavHeader(trimResult.trimmedPcm);
      fs.writeFileSync(outputPath, Buffer.from(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength));
      return { hasSpeech: true, status: 1 };
    },
  };
  return cachedInstance;
}

/**
 * Used for testing to reset or set a mock instance
 */
export function __setRustCoreInstance(instance: IRustCoreHybridObject | null): void {
  cachedInstance = instance;
}
