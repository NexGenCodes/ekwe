import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { lightTokens, darkTokens } from 'src/constants/tokens';
import {
  useSettingsStore,
  useThemeStore,
  ThemeState,
  ThemeActions,
  SettingsState,
  SettingsActions,
} from 'src/store';
import { ThemePreference } from 'src/store/settingsSlice';
import { ResolvedTheme } from 'src/store/themeSlice';

import { useTheme } from '../useTheme';

jest.mock('react-native', () => ({
  useColorScheme: jest.fn(),
}));

jest.mock('src/store', () => ({
  useSettingsStore: jest.fn(),
  useThemeStore: jest.fn(),
}));

describe('useTheme Hook', () => {
  const setResolvedMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useThemeStore as unknown as jest.Mock).mockImplementation(
      (selector: (state: Partial<ThemeState & ThemeActions>) => unknown) =>
        selector({ setResolved: setResolvedMock }),
    );
  });

  it('should return light tokens when preference is Light', () => {
    (useSettingsStore as unknown as jest.Mock).mockImplementation(
      (
        selector: (state: Partial<SettingsState & SettingsActions>) => unknown,
      ) => selector({ themePreference: ThemePreference.Light }),
    );
    (useColorScheme as unknown as jest.Mock).mockReturnValue('dark');

    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe(lightTokens);
    expect(setResolvedMock).toHaveBeenCalledWith(ResolvedTheme.Light);
  });

  it('should return dark tokens when preference is Dark', () => {
    (useSettingsStore as unknown as jest.Mock).mockImplementation(
      (
        selector: (state: Partial<SettingsState & SettingsActions>) => unknown,
      ) => selector({ themePreference: ThemePreference.Dark }),
    );
    (useColorScheme as unknown as jest.Mock).mockReturnValue('light');

    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe(darkTokens);
    expect(setResolvedMock).toHaveBeenCalledWith(ResolvedTheme.Dark);
  });

  it('should follow system theme when preference is System', () => {
    (useSettingsStore as unknown as jest.Mock).mockImplementation(
      (
        selector: (state: Partial<SettingsState & SettingsActions>) => unknown,
      ) => selector({ themePreference: ThemePreference.System }),
    );

    (useColorScheme as unknown as jest.Mock).mockReturnValue('dark');
    const { result: darkResult } = renderHook(() => useTheme());
    expect(darkResult.current).toBe(darkTokens);
    expect(setResolvedMock).toHaveBeenCalledWith(ResolvedTheme.Dark);

    (useColorScheme as unknown as jest.Mock).mockReturnValue('light');
    const { result: lightResult } = renderHook(() => useTheme());
    expect(lightResult.current).toBe(lightTokens);
    expect(setResolvedMock).toHaveBeenCalledWith(ResolvedTheme.Light);
  });
});
