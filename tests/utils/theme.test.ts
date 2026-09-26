import { renderHook, act } from '@testing-library/react-hooks';
import { Appearance } from 'react-native';
import { useSystemTheme, lightTheme, darkTheme } from '@/utils/theme';
import { useSettingsStore } from '@/state/useSettingsStore';

describe('useSystemTheme', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAllSettings();
    jest.restoreAllMocks();
    (Appearance as any)._listeners = [];
  });

  it('returns darkTheme when OS switches to dark while themeMode is system', () => {
    useSettingsStore.getState().setThemeMode('system');
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');

    const { result } = renderHook(() => useSystemTheme());
    expect(result.current.background).toBe(lightTheme.background); // '#F8F9FA'

    act(() => {
      (Appearance as any)._listeners?.forEach((l: any) =>
        l({ colorScheme: 'dark' })
      );
    });
    expect(result.current.background).toBe(darkTheme.background); // '#121212'
  });

  it('respects explicit dark user preference regardless of OS theme', () => {
    useSettingsStore.getState().setThemeMode('dark');
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');

    const { result } = renderHook(() => useSystemTheme());
    expect(result.current.background).toBe(darkTheme.background);

    act(() => {
      (Appearance as any)._listeners?.forEach((l: any) =>
        l({ colorScheme: 'light' })
      );
    });
    expect(result.current.background).toBe(darkTheme.background);
  });

  it('respects explicit light user preference regardless of OS theme', () => {
    useSettingsStore.getState().setThemeMode('light');
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');

    const { result } = renderHook(() => useSystemTheme());
    expect(result.current.background).toBe(lightTheme.background);

    act(() => {
      (Appearance as any)._listeners?.forEach((l: any) =>
        l({ colorScheme: 'dark' })
      );
    });
    expect(result.current.background).toBe(lightTheme.background);
  });

  it('does not register Appearance listener when themeMode is not system', () => {
    useSettingsStore.getState().setThemeMode('light');
    renderHook(() => useSystemTheme());
    expect((Appearance as any)._listeners).toHaveLength(0);
  });

  it('cleans up Appearance listener on unmount when themeMode is system', () => {
    useSettingsStore.getState().setThemeMode('system');
    const { unmount } = renderHook(() => useSystemTheme());
    expect((Appearance as any)._listeners.length).toBeGreaterThan(0);

    unmount();
    expect((Appearance as any)._listeners).toHaveLength(0);
  });
});
