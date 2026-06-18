// Palette — raw color values
export const palette = {
  white: "#FFFFFF",
  neutral50: "#FAFAFA",
  neutral100: "#F4F4F5",
  neutral200: "#E4E4E7",
  neutral400: "#A1A1AA",
  neutral500: "#71717A",
  neutral800: "#27272A",
  neutral900: "#18181B",
  neutral950: "#09090B",
  blue500: "#3B82F6",
  blue600: "#006FEE",
  green400: "#4ADE80",
  green500: "#17C964",
  amber400: "#FBBF24",
  amber500: "#F5A524",
  rose400: "#F87171",
  rose500: "#F31260",
  googleYellow: "#FFC107",
  googleRed: "#FF3D00",
  googleGreen: "#4CAF50",
  googleBlue: "#1976D2",
} as const;

// Flat semantic tokens (resolved per theme)
export const lightColors = {
  primary: "#09090B",
  secondary: "#006FEE",
  onPrimary: "#FAFAFA",
  onSecondary: "#FFFFFF",
  foreground: "#09090B",
  background: "#FAFAFA",
  card: "#FFFFFF",
  muted: "#5C5C66",
  surface: "#F4F4F5",
  border: "#C8C8CE",
  success: "#15803D",
  warning: "#8A5F00",
  error: "#D01358",
  info: "#005BC4",
  overlay: "rgba(0,0,0,0.4)",
  placeholder: "#6E6E78",
  disabled: "#6E6E78",
  disabledBackground: "#F4F4F5",
  caption: "#5C5C66",
} as const;

export const darkColors = {
  primary: "#FAFAFA",
  secondary: "#006FEE",
  onPrimary: "#09090B",
  onSecondary: "#FFFFFF",
  foreground: "#FAFAFA",
  background: "#09090B",
  card: "#18181B",
  muted: "#A1A1AA",
  surface: "#27272A",
  border: "#3A3A40",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  info: "#2979FF",
  overlay: "rgba(0,0,0,0.6)",
  placeholder: "#8A8A94",
  disabled: "#8A8A94",
  disabledBackground: "#27272A",
  caption: "#A1A1AA",
} as const;

export type ColorsKey = keyof typeof lightColors;

export const getTheme = (
  isDark: boolean,
): typeof lightColors | typeof darkColors =>
  isDark ? darkColors : lightColors;

export const bubbleColors = (
  isDark: boolean,
): {
  idle: string;
  recording: string;
  processing: string;
  done: string;
  error: string;
} => {
  "worklet";
  const t = isDark ? darkColors : lightColors;
  return {
    idle: t.primary,
    recording: t.error,
    processing: t.warning,
    done: t.success,
    error: t.error,
  };
};
