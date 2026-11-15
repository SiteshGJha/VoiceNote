import { create } from 'zustand';
import { DEFAULT_SETTINGS, UserSettings, ThemeMode } from './types';
import { Tone, Lang, HindiOutputFormat, AsrModelTier } from '@/ml/types';
import { VadSensitivity } from '@/audio/vadPresets';
import { logger } from '@/utils/logger';

interface SettingsStore extends UserSettings {
  setDefaultTone: (tone: Tone) => void;
  setDefaultLanguage: (lang: Lang) => void;
  setVadSensitivity: (sensitivity: VadSensitivity) => void;
  setAsrModelTier: (tier: AsrModelTier) => void;
  setHindiOutputFormat: (format: HindiOutputFormat) => void;
  setThemeMode: (theme: ThemeMode) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setHardwareTriggerButton: (button: 'volume' | 'headphone' | 'none') => void;
  setMaxHistoryRecords: (max: number) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setAutoCopyToClipboard: (enabled: boolean) => void;
  resetAllSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  setDefaultTone: (defaultTone: Tone) => {
    logger.info('SettingsStore', `Default tone updated to ${defaultTone}`);
    set({ defaultTone });
  },

  setDefaultLanguage: (defaultLanguage: Lang) => {
    logger.info('SettingsStore', `Default language updated to ${defaultLanguage}`);
    set({ defaultLanguage });
  },

  setVadSensitivity: (vadSensitivity: VadSensitivity) => {
    logger.info('SettingsStore', `VAD sensitivity updated to ${vadSensitivity}`);
    set({ vadSensitivity });
  },

  setAsrModelTier: (asrModelTier: AsrModelTier) => {
    logger.info('SettingsStore', `ASR model tier updated to ${asrModelTier}`);
    set({ asrModelTier });
  },

  setHindiOutputFormat: (hindiOutputFormat: HindiOutputFormat) => {
    logger.info('SettingsStore', `Hindi output format updated to ${hindiOutputFormat}`);
    set({ hindiOutputFormat });
  },

  setThemeMode: (themeMode: ThemeMode) => {
    logger.info('SettingsStore', `Theme mode updated to ${themeMode}`);
    set({ themeMode });
  },

  setHapticsEnabled: (hapticsEnabled: boolean) => {
    logger.info('SettingsStore', `Haptics enabled: ${hapticsEnabled}`);
    set({ hapticsEnabled });
  },

  setHardwareTriggerButton: (hardwareTriggerButton: 'volume' | 'headphone' | 'none') => {
    logger.info('SettingsStore', `Hardware trigger button updated to ${hardwareTriggerButton}`);
    set({ hardwareTriggerButton });
  },

  setMaxHistoryRecords: (maxHistoryRecords: number) => {
    logger.info('SettingsStore', `Max history records updated to ${maxHistoryRecords}`);
    set({ maxHistoryRecords });
  },

  setHasCompletedOnboarding: (hasCompletedOnboarding: boolean) => {
    logger.info('SettingsStore', `Onboarding completed state updated to ${hasCompletedOnboarding}`);
    set({ hasCompletedOnboarding });
  },

  setAutoCopyToClipboard: (autoCopyToClipboard: boolean) => {
    logger.info('SettingsStore', `Auto copy to clipboard updated to ${autoCopyToClipboard}`);
    set({ autoCopyToClipboard });
  },

  resetAllSettings: () => {
    logger.info('SettingsStore', 'Resetting all settings to factory default');
    set({ ...DEFAULT_SETTINGS });
  },
}));
