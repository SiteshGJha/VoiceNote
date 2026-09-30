import { useEffect } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { DoublePressDetector } from '@/services/doublePressDetector';
import { useSettingsStore } from '@/state/useSettingsStore';
import { logger } from '@/utils/logger';

export type TriggerButton = 'volume' | 'headphone' | 'none';

export interface HardwareTriggerModule {
  setButton(button: TriggerButton): Promise<void>;
}

// Native module binding (mocked gracefully when native module is unavailable in simulator/jest)
const NativeHardwareTrigger = NativeModules.VoiceNoteHardwareTrigger ?? {
  setButton: async (_btn: string) => {},
};

export const hardwareTrigger = {
  setButton: async (button: TriggerButton): Promise<void> => {
    try {
      await NativeHardwareTrigger.setButton(button);
      logger.info('HardwareTrigger', `Configured native hardware trigger button: ${button}`);
    } catch (err) {
      logger.warn('HardwareTrigger', `Failed to set hardware button ${button}`, err);
    }
  },
};

/**
 * Hook to listen for hardware double-press events.
 */
export function useHardwareTrigger(onTrigger: () => void): void {
  const triggerButton = useSettingsStore((s) => s.hardwareTriggerButton);

  useEffect(() => {
    if (triggerButton === 'none') {
      return;
    }

    if (!NativeModules.VoiceNoteHardwareTrigger) {
      logger.info('HardwareTrigger', 'Native hardware trigger module not available on this platform/target');
      return;
    }

    const detector = new DoublePressDetector(400);
    hardwareTrigger.setButton(triggerButton);

    try {
      const emitter = new NativeEventEmitter(NativeModules.VoiceNoteHardwareTrigger);
      const subscription = emitter.addListener('VoiceNoteHardwareTrigger', (event: { button?: string }) => {
        logger.info('HardwareTrigger', `Received hardware press event: ${event?.button}`);
        if (detector.press()) {
          logger.info('HardwareTrigger', 'Double-press confirmed, firing trigger callback');
          onTrigger();
        }
      });

      return () => {
        subscription.remove?.();
        hardwareTrigger.setButton('none');
      };
    } catch (err) {
      logger.warn('HardwareTrigger', 'Failed to initialize NativeEventEmitter for hardware trigger', err);
      return () => {
        hardwareTrigger.setButton('none');
      };
    }
  }, [triggerButton, onTrigger]);
}
