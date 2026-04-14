import { useColorScheme } from 'nativewind';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { getColor, bubbleColors } from '@/constants/colors';

export interface ThemeTokens {
  colorScheme: 'light' | 'dark' | 'system';
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
  color: {
    primary: string;
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

  return {
    colorScheme: colorScheme as 'light' | 'dark' | 'system',
    setColorScheme,
    isDark,
    color: {
      primary: getColor('primary', isDark),
      background: getColor('background', isDark),
      card: getColor('card', isDark),
      muted: getColor('muted', isDark),
      border: getColor('border', isDark),
      success: getColor('success', isDark),
      warning: getColor('warning', isDark),
      error: getColor('error', isDark),
      bubble: bubbleColors(isDark),
    },
    shadow: {
      overlay: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
      },
    },
  };
};
