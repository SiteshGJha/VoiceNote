import { Platform } from 'react-native';

export type HapticType = 'impactLight' | 'impactMedium' | 'impactHeavy' | 'success' | 'warning' | 'error';

export const haptics = {
  trigger: (type: HapticType = 'impactLight'): void => {
    // Gracefully handle web, mock test environments, or devices without haptics
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }
    // In production apps, this maps to react-native-haptic-feedback
    try {
      // Safe dynamic invocation if installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ReactNativeHapticFeedback = require('react-native-haptic-feedback');
      if (ReactNativeHapticFeedback?.trigger) {
        ReactNativeHapticFeedback.trigger(type, {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: false,
        });
      }
    } catch {
      // Haptics not linked in test or dev environment - ignore safely
    }
  },
};
