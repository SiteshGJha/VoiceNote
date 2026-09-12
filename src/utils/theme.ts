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
  waveformBar: '#63B3ED',
  recordActive: '#FC8181',
};
