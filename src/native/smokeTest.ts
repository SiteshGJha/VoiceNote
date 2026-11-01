import { logger } from '@/utils/logger';
import { getRustCore } from './rustCore';

export interface NativeBridgeStatus {
  isNitroAvailable: boolean;
  isAudioEngineReady: boolean;
  isAsrBridgeReady: boolean;
  isSlmBridgeReady: boolean;
  rustCoreVersion: string;
  status: 'ok' | 'degraded' | 'unavailable';
}

/**
 * Validates native module runtime availability via JSI / Nitro.
 * Can be invoked on app startup and in unit/smoke tests.
 */
export function __smokeTest(): 'ok' | 'fail' {
  try {
    const rustCore = getRustCore();
    const version = rustCore?.getVersion();
    if (typeof version === 'string' && version.length > 0 && version !== 'unavailable') {
      return 'ok';
    }
    return 'fail';
  } catch (error) {
    logger.error('NativeSmokeTest', 'Smoke test failed', error);
    return 'fail';
  }
}

export function getNativeBridgeStatus(): NativeBridgeStatus {
  try {
    const rustCore = getRustCore();
    const version = rustCore ? rustCore.getVersion() : 'unavailable';
    const isReady = !!rustCore && typeof version === 'string' && version !== 'unavailable' && version.length > 0;

    return {
      isNitroAvailable: isReady,
      isAudioEngineReady: isReady,
      isAsrBridgeReady: isReady,
      isSlmBridgeReady: isReady,
      rustCoreVersion: version,
      status: isReady ? 'ok' : 'unavailable',
    };
  } catch (error) {
    logger.error('NativeSmokeTest', 'Failed to get native bridge status', error);
    return {
      isNitroAvailable: false,
      isAudioEngineReady: false,
      isAsrBridgeReady: false,
      isSlmBridgeReady: false,
      rustCoreVersion: 'unavailable',
      status: 'unavailable',
    };
  }
}
