import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from '@/navigation/AppNavigator';
import { useSettingsStore } from '@/state/useSettingsStore';
import { __smokeTest } from '@/native/smokeTest';
import { modelInstaller } from '@/services/modelManager';
import { logger } from '@/utils/logger';

export const App: React.FC = () => {
  const themeMode = useSettingsStore((s) => s.themeMode);

  useEffect(() => {
    logger.info('App', 'VoiceNote initialized in offline mode');
    // Run native bridge smoke test on startup
    const smokeResult = __smokeTest();
    logger.info('App', `Native module JSI smoke test status: ${smokeResult}`);
    // Initialize model manager on startup to reconcile manifests
    modelInstaller.initialize().catch((err) => {
      logger.warn('App', 'Model manager initialization failed on startup', err);
    });
  }, []);

  const barStyle = themeMode === 'dark' ? 'light-content' : 'dark-content';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={barStyle} />
      <AppNavigator />
    </SafeAreaProvider>
  );
};

export default App;
