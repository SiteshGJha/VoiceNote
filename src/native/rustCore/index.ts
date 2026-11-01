import * as fs from 'fs';
import { IRustCoreHybridObject } from './types';
import { trimSilence } from '@/audio/silenceTrim';
import { calculateRms, wrapPcmWithWavHeader } from '@/audio/wavUtils';
import { MlError } from '@/ml/errors';

export * from './types';

interface NitroProvider {
  createHybridObject<T>(name: string): T;
}

interface GlobalWithNitro {
  NitroModules?: NitroProvider;
  NitroModulesProxy?: NitroProvider;
}

let cachedInstance: IRustCoreHybridObject | null = null;

function createDefaultMockInstance(): IRustCoreHybridObject {
  return {
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
    evalVad: (pcm: ArrayBuffer, sensitivityMode: number = 2) => {
      const uint8 = new Uint8Array(pcm);
      const { normalized } = calculateRms(uint8);
      const modeThresholds: Record<number, number> = {
        0: 0.70,
        1: 0.60,
        2: 0.50,
        3: 0.40,
      };
      const threshold = modeThresholds[sensitivityMode] ?? 0.50;
      return {
        isSpeech: normalized >= threshold,
        probability: normalized,
      };
    },
    transcribe: (
      pcm: ArrayBuffer,
      _modelPath: string,
      language?: string,
      prompt?: string,
      _timeoutMs: number = 30000
    ) => {
      if (pcm.byteLength === 0) {
        throw new MlError('ASR_EMPTY_OUTPUT', 'Cannot transcribe empty audio buffer');
      }
      let detected = language ?? 'en';
      let mockTranscript = 'This is an important offline voice note.';

      if (language === 'hi') {
        mockTranscript = 'यह एक महत्वपूर्ण ऑफलाइन वॉइस नोट है।';
        detected = 'hi';
      } else if (prompt?.includes('Hindi') || prompt?.includes('Hinglish')) {
        mockTranscript = 'Meeting kal subah 10 baje scheduled hai.';
        detected = 'en';
      }

      return {
        text: mockTranscript,
        detectedLang: detected,
        durationMs: 150,
      };
    },
  };
}

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
  cachedInstance = createDefaultMockInstance();
  return cachedInstance;
}

/**
 * Used for testing to reset or set a mock instance
 */
export function __setRustCoreInstance(instance: Partial<IRustCoreHybridObject> | null): void {
  if (instance) {
    cachedInstance = {
      ...createDefaultMockInstance(),
      ...instance,
    };
  } else {
    cachedInstance = null;
  }
}
