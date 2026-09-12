import { Tone, Lang, HindiOutputFormat, AsrModelTier } from '@/ml/types';
import { VadSensitivity } from '@/audio/vadPresets';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserSettings {
  defaultTone: Tone;
  defaultLanguage: Lang;
  vadSensitivity: VadSensitivity;
  asrModelTier: AsrModelTier;
  hindiOutputFormat: HindiOutputFormat;
  themeMode: ThemeMode;
  hapticsEnabled: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultTone: 'professional',
  defaultLanguage: 'auto',
  vadSensitivity: 'medium',
  asrModelTier: 'balanced',
  hindiOutputFormat: 'devanagari',
  themeMode: 'system',
  hapticsEnabled: true,
};
