// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  // WARNING [NATIVE SYNC]: If you change 'secondary.DEFAULT' (#1A7EC8), you MUST manually
  // update the hex color in `ShareActivity.kt` down in the `modules/ekwe-native` folder.
  // Kotlin requires a hardcoded hex for the instant-boot "Echo" native spinner.
  primary: { DEFAULT: '#0A1F30', dark: '#F8FAFC' }, // Navy light, Slate 50 dark
  secondary: { DEFAULT: '#1A7EC8', dark: '#1A7EC8' }, // Accent Blue
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#09090B' },
  background: { DEFAULT: '#FFFFFF', dark: '#09090B' }, // Pure White light, Midnight Noir dark
  foreground: { DEFAULT: '#09090B', dark: '#F8FAFC' },
  card: { DEFAULT: '#FAFAFA', dark: '#18181B' }, // Slightly off-white for cards on pure white background
  muted: { DEFAULT: '#52525B', dark: '#A1A1AA' },
  border: { DEFAULT: '#E4E4E7', dark: '#27272A' },
  success: { DEFAULT: '#10B981', dark: '#10B981' },
  warning: { DEFAULT: '#F59E0B', dark: '#F59E0B' },
  error: { DEFAULT: '#EF4444', dark: '#EF4444' },
  info: { DEFAULT: '#3B82F6', dark: '#3B82F6' },
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
