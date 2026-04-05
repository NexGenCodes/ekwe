// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  primary: { DEFAULT: '#032879ff', dark: '#015ef5ff' },
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#FFFFFF' },
  background: { DEFAULT: '#FFFFFF', dark: '#09090B' },
  foreground: { DEFAULT: '#09090B', dark: '#FAFAFA' },
  card: { DEFAULT: '#F4F4F5', dark: '#18181B' },
  muted: { DEFAULT: '#71717A', dark: '#A1A1AA' },
  border: { DEFAULT: '#E4E4E7', dark: '#27272A' },
  success: { DEFAULT: '#16A34A', dark: '#22C55E' },
  warning: { DEFAULT: '#D97706', dark: '#F59E0B' },
  error: { DEFAULT: '#DC2626', dark: '#EF4444' },
  info: { DEFAULT: '#2563EB', dark: '#3b82f6ff' },
} as const;

export type ColorKey = keyof typeof colors;

/**
 * Returns the resolved hex color for a given key and mode.
 * Used ONLY where Tailwind classes cannot reach:
 * tab bar tint, Switch trackColor, SVG icon color props.
 */
export const getColor = (key: ColorKey, isDark: boolean): string =>
  isDark ? colors[key].dark : colors[key].DEFAULT;

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
} => ({
  idle: getColor('primary', isDark),
  recording: getColor('error', isDark),
  processing: getColor('warning', isDark),
  done: getColor('success', isDark),
  error: getColor('error', isDark),
});
