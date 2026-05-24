import { useSelector } from '@legendapp/state/react';
import { useMemo, useCallback } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { getColor, bubbleColors } from '@/constants/colors';
import { settings$, ThemePreference } from '@/store/settings';

export interface ThemeTokens {
  colorScheme: 'light' | 'dark' | 'system';
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
  color: {
    primary: string;
    secondary: string;
    onPrimary: string;
    onSecondary: string;
    foreground: string;
    background: string;
    card: string;
    muted: string;
    surface: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    bubble: {
      idle: string;
      recording: string;
      processing: string;
      done: string;
      error: string;
    };
  };
  shadow: {
    overlay: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  isDark: boolean;
}

export const useTheme = (): ThemeTokens => {
  const systemColorScheme = useSystemColorScheme();
  // Read preference from Legend-State — ALL hook instances react to this simultaneously
  const preference = useSelector(() => settings$.themePreference.get()) as
    | 'light'
    | 'dark'
    | 'system';

  const resolvedScheme =
    preference === 'system' ? systemColorScheme : preference;
  const isDark = resolvedScheme === 'dark';

  // Stable reference: only recomputes when theme actually switches.
  const color = useMemo(
    () => ({
      primary: getColor('primary', isDark),
      secondary: getColor('secondary', isDark),
      onPrimary: getColor('onPrimary', isDark),
      onSecondary: getColor('onSecondary', isDark),
      foreground: getColor('foreground', isDark),
      background: getColor('background', isDark),
      card: getColor('card', isDark),
      muted: getColor('muted', isDark),
      surface: getColor('surface', isDark),
      border: getColor('border', isDark),
      success: getColor('success', isDark),
      warning: getColor('warning', isDark),
      error: getColor('error', isDark),
      bubble: bubbleColors(isDark),
    }),
    [isDark],
  );

  // Shadow tokens never change — allocate once for the lifetime of the app.
  const shadow = useMemo(
    () => ({
      overlay: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
    [],
  );

  const setColorScheme = useCallback((scheme: 'light' | 'dark' | 'system') => {
    settings$.themePreference.set(scheme as ThemePreference);
  }, []);

  return useMemo(
    () => ({
      colorScheme: preference,
      setColorScheme,
      isDark,
      color,
      shadow,
    }),
    [preference, setColorScheme, isDark, color, shadow],
  );
};
