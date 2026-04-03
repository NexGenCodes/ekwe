import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { lightTokens, darkTokens, Tokens } from 'src/constants/tokens';
import { useThemeStore, useSettingsStore } from 'src/store';
import { ThemePreference } from 'src/store/settingsSlice';
import { ResolvedTheme } from 'src/store/themeSlice';

export interface ThemeHook {
  tokens: Tokens;
  id: ResolvedTheme;
  toggleTheme: () => void;
}

export const useTheme = (): ThemeHook => {
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const setResolved = useThemeStore((s) => s.setResolved);
  const systemScheme = useColorScheme();

  const resolved: ResolvedTheme = ((): ResolvedTheme => {
    if (themePreference === ThemePreference.Light) {
      return ResolvedTheme.Light;
    }
    if (themePreference === ThemePreference.Dark) {
      return ResolvedTheme.Dark;
    }
    return systemScheme === 'dark' ? ResolvedTheme.Dark : ResolvedTheme.Light;
  })();

  const toggleTheme = (): void => {
    const next =
      resolved === ResolvedTheme.Light
        ? ThemePreference.Dark
        : ThemePreference.Light;
    setThemePreference(next);
  };

  useEffect(() => {
    setResolved(resolved);
  }, [resolved, setResolved]);

  return {
    tokens: resolved === ResolvedTheme.Dark ? darkTokens : lightTokens,
    id: resolved,
    toggleTheme,
  };
};
