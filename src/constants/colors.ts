// Single source of truth for the Ekwe color system.
// Both tailwind.config.js and JS-access (getColor) read from this file.
// Palette: blue primary, black/white, + status colors. That's it.

export const colors = {
  // WARNING [NATIVE SYNC]: If you change 'primary.dark' (#1A7EC8), you MUST manually 
  // update the hex color in `ShareActivity.kt` down in the `expo.modules.ekwenative` folder.
  // Kotlin requires a hardcoded hex for the instant-boot "Echo" native spinner.
  primary: { DEFAULT: '#0A1F30', dark: '#1A7EC8' }, // Navy light, Accent Blue dark
  onPrimary: { DEFAULT: '#FFFFFF', dark: '#FFFFFF' },
  background: { DEFAULT: '#FFFFFF', dark: '#09090B' }, // Pure white light, premium true OLED-friendly deep Zinc
  foreground: { DEFAULT: '#09090B', dark: '#F8FAFC' }, // Zinc 950 light, Slate 50 dark
  card: { DEFAULT: '#F1F5F9', dark: '#18181B' }, // Slate 100 for light, Zinc 900 for dark (premium subtle elevation)
  muted: { DEFAULT: '#64748B', dark: '#94A3B8' }, // Slate 500 light, Slate 400 dark (Perfect contrast secondary text)
  border: { DEFAULT: '#E2E8F0', dark: '#27272A' }, // Slate 200 light, Zinc 800 dark
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
