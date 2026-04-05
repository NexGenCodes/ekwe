import { useColorScheme } from 'nativewind';
import { getColor, bubbleColors } from 'src/constants/colors';

export interface ThemeTokens {
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
}

export const useTheme = (): ThemeTokens => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return {
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
