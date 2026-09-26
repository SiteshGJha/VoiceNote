import { useEffect, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { useSettingsStore } from '@/state/useSettingsStore';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryLight: string;
  accent: string;
  danger: string;
  dangerSurface: string;
  success: string;
  warning: string;
  warningLight: string;
  waveformBar: string;
  recordActive: string;
}

export const lightTheme: ThemeColors = {
  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceSubtle: '#F1F3F5',
  border: '#E9ECEF',
  textPrimary: '#212529',
  textSecondary: '#495057',
  textMuted: '#868E96',
  primary: '#2B6CB0',
  primaryLight: '#EBF8FF',
  accent: '#319795',
  danger: '#E53E3E',
  dangerSurface: '#FFF5F5',
  success: '#38A169',
  warning: '#D69E2E',
  warningLight: '#FFF9E6',
  waveformBar: '#4299E1',
  recordActive: '#E53E3E',
};

export const darkTheme: ThemeColors = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceSubtle: '#2A2A2A',
  border: '#333333',
  textPrimary: '#F8F9FA',
  textSecondary: '#CED4DA',
  textMuted: '#6C757D',
  primary: '#63B3ED',
  primaryLight: '#1A365D',
  accent: '#4FD1C5',
  danger: '#FC8181',
  dangerSurface: '#4A1515',
  success: '#68D391',
  warning: '#F6E05E',
  warningLight: '#4A3F1E',
  waveformBar: '#63B3ED',
  recordActive: '#FC8181',
};

export function useSystemTheme(): ThemeColors {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const [osScheme, setOsScheme] = useState<ColorSchemeName>(Appearance?.getColorScheme?.() ?? 'light');

  useEffect(() => {
    if (themeMode !== 'system' || !Appearance?.addChangeListener) return;
    setOsScheme(Appearance?.getColorScheme?.() ?? 'light');
    const sub = Appearance.addChangeListener(({ colorScheme }) => setOsScheme(colorScheme));
    return () => sub?.remove?.();
  }, [themeMode]);

  if (themeMode === 'dark') return darkTheme;
  if (themeMode === 'light') return lightTheme;
  return osScheme === 'dark' ? darkTheme : lightTheme;
}

