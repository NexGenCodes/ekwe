// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  // WARNING [NATIVE SYNC]: If you change 'primary.dark' (#1A7EC8), you MUST manually
  // update the hex color in `ShareActivity.kt` down in the `expo.modules.ekwenative` folder.
  // Kotlin requires a hardcoded hex for the instant-boot "Echo" native spinner.
  primary: { DEFAULT: '#09090B', dark: '#3B82F6' }, // Zinc 950 light, Bright Blue dark
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#FFFFFF' },
  background: { DEFAULT: '#FFFFFF', dark: '#09090B' }, // Pure white light, premium true OLED-friendly deep Zinc
  foreground: { DEFAULT: '#09090B', dark: '#F8FAFC' }, // Zinc 950 light, Slate 50 dark
  card: { DEFAULT: '#F4F4F5', dark: '#18181B' }, // Zinc 100 for light, Zinc 900 for dark
  muted: { DEFAULT: '#52525B', dark: '#A1A1AA' }, // Zinc 600 light, Zinc 400 dark (High contrast secondary text)
  border: { DEFAULT: '#E4E4E7', dark: '#27272A' }, // Zinc 200 light, Zinc 800 dark
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
