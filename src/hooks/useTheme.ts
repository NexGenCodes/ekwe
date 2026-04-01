import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { lightTokens, darkTokens } from 'src/constants/tokens';
import type { Tokens } from 'src/constants/tokens';
import { useStore } from 'src/store';
import { ThemePreference } from 'src/store/settingsSlice';
import { ResolvedTheme } from 'src/store/themeSlice';

export const useTheme = (): Tokens => {
  const themePreference = useStore((s) => s.themePreference);
  const setResolved = useStore((s) => s.setResolved);
  const systemColorScheme = useColorScheme();

  const resolved: ResolvedTheme = ((): ResolvedTheme => {
    if (themePreference === ThemePreference.LIGHT) {
      return ResolvedTheme.LIGHT;
    }
    if (themePreference === ThemePreference.DARK) {
      return ResolvedTheme.DARK;
    }
    // ThemePreference.SYSTEM
    return systemColorScheme === 'dark'
      ? ResolvedTheme.DARK
      : ResolvedTheme.LIGHT;
  })();

  useEffect((): void => {
    setResolved(resolved);
  }, [resolved, setResolved]);

  return resolved === ResolvedTheme.LIGHT ? lightTokens : darkTokens;
};
