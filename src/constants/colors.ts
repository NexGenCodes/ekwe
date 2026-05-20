// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  // WARNING [NATIVE SYNC]: If you change 'secondary.DEFAULT', update ShareActivity.kt
  primary: { DEFAULT: '#0A1F30', dark: '#FFFFFF' }, // Ekwe Navy / Pure White
  secondary: { DEFAULT: '#1A7EC8', dark: '#3B82F6' }, // Ekwe Accent Blue
  onSecondary: { DEFAULT: '#f1f2f5ff', dark: '#FFFFFF' }, // Contrasting text for secondary
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#0F172A' }, // Pure White / Slate 900
  background: { DEFAULT: '#F8FAFC', dark: '#0F172A' }, // Clean Light / Slate 900
  foreground: { DEFAULT: '#0F172A', dark: '#F8FAFC' },
  card: { DEFAULT: '#FFFFFF', dark: '#1E293B' }, // Slate 800 for dark cards
  muted: { DEFAULT: '#64748B', dark: '#94A3B8' }, // Slate 500 / Slate 400
  surface: { DEFAULT: '#F1F5F9', dark: '#334155' }, // Slate 100 / Slate 700
  border: { DEFAULT: '#E2E8F0', dark: '#334155' }, // Slate 200 / Slate 700
  success: { DEFAULT: '#10B981', dark: '#34D399' },
  warning: { DEFAULT: '#F59E0B', dark: '#FBBF24' },
  error: { DEFAULT: '#EF4444', dark: '#F87171' },
  info: { DEFAULT: '#1A7EC8', dark: '#3B82F6' },
} as const;

export type ColorKey = keyof typeof colors;

/**
 * Returns the resolved hex color for a given key and mode.
 * Used ONLY where Tailwind classes cannot reach:
 * tab bar tint, Switch trackColor, SVG icon color props.
 */
export const getColor = (key: ColorKey, isDark: boolean): string => {
  'worklet';
  return isDark ? colors[key].dark : colors[key].DEFAULT;
};

/**
 * Bubble state colors derived from the palette.
 * Idle = primary, recording = error, processing = warning, done = success.
 */
export const bubbleColors = (
  isDark: boolean,
): {
  idle: string;
  recording: string;
  processing: string;
  done: string;
  error: string;
} => {
  'worklet';
  return {
    idle: getColor('primary', isDark),
    recording: getColor('error', isDark),
    processing: getColor('warning', isDark),
    done: getColor('success', isDark),
    error: getColor('error', isDark),
  };
};
