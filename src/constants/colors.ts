// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  primary: { DEFAULT: '#2563EB', dark: '#3B82F6' }, // Modern startup Blue (Passes WCAG AA on light/dark backgrounds)
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#FFFFFF' },
  background: { DEFAULT: '#FFFFFF', dark: '#09090B' }, // Pure white light, premium true OLED-friendly deep Zinc
  foreground: { DEFAULT: '#09090B', dark: '#FAFAFA' }, // Zinc 950 (ultra-crisp, no eye strain) light, Zinc 50 dark
  card: { DEFAULT: '#F4F4F5', dark: '#18181B' }, // Zinc 100 card for light, Zinc 900 for dark (premium subtle elevation)
  muted: { DEFAULT: '#71717A', dark: '#A1A1AA' }, // Zinc 500/400 (Perfect 4.5:1+ contrast secondary text)
  border: { DEFAULT: '#E4E4E7', dark: '#27272A' }, // Ultra-sleek dividers (Zinc 200 light, Zinc 800 dark)
  success: { DEFAULT: '#16A34A', dark: '#22C55E' }, // Crisp Green
  warning: { DEFAULT: '#D97706', dark: '#F59E0B' }, // Crisp Amber
  error: { DEFAULT: '#DC2626', dark: '#EF4444' }, // Crisp Red
  info: { DEFAULT: '#0284C7', dark: '#38BDF8' }, // Light blue
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
