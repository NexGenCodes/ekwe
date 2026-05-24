// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  // WARNING [NATIVE SYNC]: If you change 'secondary.DEFAULT', update ShareActivity.kt
  primary: { DEFAULT: '#09090B', dark: '#FAFAFA' }, // Zinc 950 / Zinc 50
  onPrimary: { DEFAULT: '#FAFAFA', dark: '#09090B' }, // Inverted
  secondary: { DEFAULT: '#006FEE', dark: '#3B82F6' }, // Vibrant Blue Accent
  onSecondary: { DEFAULT: '#FFFFFF', dark: '#FFFFFF' }, // Always white text on the vibrant blue
  background: { DEFAULT: '#FAFAFA', dark: '#09090B' }, // Off-white / True deep dark
  foreground: { DEFAULT: '#09090B', dark: '#FAFAFA' },
  card: { DEFAULT: '#FFFFFF', dark: '#18181B' }, // Pure white / Zinc 900
  muted: { DEFAULT: '#71717A', dark: '#A1A1AA' }, // Zinc 500 / Zinc 400
  surface: { DEFAULT: '#F4F4F5', dark: '#27272aff' }, // Zinc 100 / Zinc 800
  border: { DEFAULT: '#E4E4E7', dark: '#27272A' }, // Zinc 200 / Zinc 800
  success: { DEFAULT: '#17C964', dark: '#4ADE80' }, // Vibrant Green
  warning: { DEFAULT: '#F5A524', dark: '#FBBF24' }, // Vibrant Orange/Amber
  error: { DEFAULT: '#F31260', dark: '#F87171' }, // Vibrant Rose/Red
  info: { DEFAULT: '#006FEE', dark: '#3B82F6' },
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
