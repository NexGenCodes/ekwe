import { useColorScheme } from 'nativewind';
import { useMemo, useCallback } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { getColor, bubbleColors } from '@/constants/colors';

export interface ThemeTokens {
  colorScheme: 'light' | 'dark' | 'system';
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
  color: {
    primary: string;
    secondary: string;
    onPrimary: string;
    foreground: string;
    background: string;
    card: string;
    muted: string;
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
  const { colorScheme, setColorScheme } = useColorScheme();
  const systemColorScheme = useSystemColorScheme();

  // Cast to string to avoid TS error: NativeWind types this strictly as light/dark,
  // but we still want a safety net in case it holds 'system' temporarily.
  const resolvedColorScheme =
    (colorScheme as string) === 'system' ? systemColorScheme : colorScheme;
  const isDark = resolvedColorScheme === 'dark';

  // Stable reference: only recomputes when theme actually switches.
  // Without this, every useTheme() consumer gets a new object on every render,
  // defeating React.memo and causing cascade re-renders across the entire tree.
  const color = useMemo(
    () => ({
      primary: getColor('primary', isDark),
      secondary: getColor('secondary', isDark),
      onPrimary: getColor('onPrimary', isDark),
      foreground: getColor('foreground', isDark),
      background: getColor('background', isDark),
      card: getColor('card', isDark),
      muted: getColor('muted', isDark),
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

  const setScheme = useCallback(
    (scheme: 'light' | 'dark' | 'system') => setColorScheme(scheme),
    [setColorScheme],
  );

  return useMemo(
    () => ({
      colorScheme: colorScheme as 'light' | 'dark' | 'system',
      setColorScheme: setScheme,
      isDark,
      color,
      shadow,
    }),
    [colorScheme, setScheme, isDark, color, shadow],
  );
};
