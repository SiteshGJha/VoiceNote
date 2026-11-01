import * as crypto from 'crypto';
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
    resetVad: () => {
      // In-memory mock reset
    },
    transcribe: async (
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
    generate: async (
      prompt: string,
      modelPath: string,
      _temperature?: number,
      _topP?: number,
      _maxTokens?: number,
      _timeoutMs: number = 10000
    ) => {
      if (!modelPath) {
        throw new MlError('ASR_MODEL_MISSING', 'SLM model path is missing');
      }
      const inputMarker = 'Input:';
      const outputMarker = 'Output:';
      const inputIndex = prompt.indexOf(inputMarker);
      const outputIndex = prompt.lastIndexOf(outputMarker);

      let rawInput = '';
      if (inputIndex !== -1 && outputIndex !== -1) {
        rawInput = prompt.slice(inputIndex + inputMarker.length, outputIndex).trim();
      } else {
        rawInput = prompt;
      }

      let rewritten = rawInput;
      if (prompt.includes('professional')) {
        rewritten = rawInput
          .replace(/\b(um|uh|like|you know|matlab|arre)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (rewritten.length > 0) {
          rewritten = rewritten.charAt(0).toUpperCase() + rewritten.slice(1);
          if (!/[.!?]$/.test(rewritten)) {
            rewritten += '.';
          }
        }
      } else {
        rewritten = rawInput
          .replace(/\b(um|uh|matlab|arre)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      return {
        text: rewritten,
        durationMs: 150,
      };
    },
    verifyFileSha256: (filePath: string, expectedHex: string): boolean => {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const actualHex = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        return actualHex.toLowerCase() === expectedHex.trim().toLowerCase();
      } catch {
        return false;
      }
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
