import { useColorScheme } from 'nativewind';
import { getColor } from 'src/constants/theme';

export interface ThemeTokens {
  color: {
    brand: { bright: string };
    text: { inverse: string };
    background: { primary: string };
    border: { strong: string };
    bubble: {
      idle: string;
      recording: string;
      processing: string;
      done: string;
      error: string;
    };
  };
  space: Record<number, number>;
  radius: { full: number; xl: number };
  font: {
    family: { bodyMed: string };
    size: { caption: number };
    letterSpacing: { label: number };
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
      brand: {
        bright: '#FFFFFF',
      },
      text: {
        inverse: '#FFFFFF',
      },
      background: {
        primary: isDark ? '#09090B' : '#FFFFFF',
      },
      border: {
        strong: isDark ? '#3F3F46' : '#D4D4D8',
      },
      bubble: {
        idle: getColor('bubble.idle', isDark),
        recording: getColor('bubble.recording', isDark),
        processing: getColor('bubble.processing', isDark),
        done: getColor('bubble.done', isDark),
        error: getColor('bubble.error', isDark),
      },
    },
    space: {
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      6: 24,
    },
    radius: {
      full: 9999,
      xl: 24,
    },
    font: {
      family: {
        bodyMed: 'Outfit-Medium',
      },
      size: {
        caption: 12,
      },
      letterSpacing: {
        label: 0.5,
      },
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
