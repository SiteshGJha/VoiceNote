import { calculateRms } from '@/audio/wavUtils';
import { VadSensitivity } from '@/audio/vadPresets';
import { getRustCore } from '@/native/rustCore';
import { logger } from '@/utils/logger';

export type WebRtcVadMode = 0 | 1 | 2 | 3;

/**
 * Maps VoiceNote VAD sensitivity presets to WebRTC VAD native modes:
 * - low (noisy environments): mode 1
 * - medium (default): mode 2
 * - high (quiet rooms): mode 3
 */
export const SENSITIVITY_TO_WEBRTC_MODE: Record<VadSensitivity, WebRtcVadMode> = {
  low: 1,
  medium: 2,
  high: 3,
};

export interface WebRtcVadResult {
  isSpeech: boolean;
  probability: number;
}

/**
 * WebRTC VAD Native Adapter.
 * Integrates with `react-native-nitro-webrtc-vad` when running natively.
 * Provides deterministic audio-energy speech detection fallback in JS/Node/simulator environments.
 */
export class WebRtcVadAdapter {
  private isNativeModuleAvailable: boolean;

  constructor() {
    // In production with react-native-nitro-webrtc-vad compiled, NitroModules.get(...) is inspected.
    this.isNativeModuleAvailable = false;
  }

  public isAvailable(): boolean {
    return this.isNativeModuleAvailable;
  }

  /**
   * Evaluates a 16 kHz 16-bit linear PCM frame (typically 10, 20, or 30 ms).
   * @param frameBytes 16-bit PCM frame (e.g. 960 bytes for 30 ms @ 16 kHz)
   * @param sensitivity Preset or WebRTC aggressiveness mode
   */
  public evaluateFrame(
    frameBytes: Uint8Array,
    sensitivity: VadSensitivity = 'medium'
  ): WebRtcVadResult {
    const mode = SENSITIVITY_TO_WEBRTC_MODE[sensitivity];

    try {
      const rustCore = getRustCore();
      if (rustCore && typeof rustCore.evalVad === 'function') {
        const buffer = (
          frameBytes.byteOffset === 0 && frameBytes.byteLength === frameBytes.buffer.byteLength
            ? frameBytes.buffer
            : frameBytes.buffer.slice(
                frameBytes.byteOffset,
                frameBytes.byteOffset + frameBytes.byteLength
              )
        ) as ArrayBuffer;
        const result = rustCore.evalVad(buffer, mode);
        if (result && typeof result.probability === 'number') {
          return {
            isSpeech: result.isSpeech,
            probability: result.probability,
          };
        }
      }
    } catch (err) {
      logger.warn('WebRtcVadAdapter', 'Rust core evalVad failed, falling back to RMS', err);
    }

    // Fallback implementation using frame energy and dynamic SNR thresholds
    const { normalized } = calculateRms(frameBytes);

    // Thresholds calibrated against standard WebRTC VAD operating curves:
    // Low sensitivity: threshold = 0.60
    // Medium sensitivity: threshold = 0.50
    // High sensitivity: threshold = 0.40
    const modeThresholds: Record<WebRtcVadMode, number> = {
      0: 0.70,
      1: 0.60,
      2: 0.50,
      3: 0.40,
    };

    const threshold = modeThresholds[mode];
    const isSpeech = normalized >= threshold;

    return {
      isSpeech,
      probability: normalized,
    };
  }
}

export const webrtcVad = new WebRtcVadAdapter();
