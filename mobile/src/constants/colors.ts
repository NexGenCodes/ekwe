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
  foreground: "#09090B",
  background: "#FFFFFF",
  card: "#FAFAFA",
  surface: "#F4F4F5",
  border: "#C8C8CE",
  muted: "#5C5C66",
  disabled: "#6E6E78",
  brand: "#006FEE",
  onBrand: "#FFFFFF",
  success: "#15803D",
  warning: "#92400E",
  error: "#D01358",
  info: "#005BC4",
  overlay: "rgba(0,0,0,0.4)",
} as const;

export const darkColors = {
  foreground: "#FAFAFA",
  background: "#09090B",
  card: "#18181B",
  surface: "#27272A",
  border: "#3A3A40",
  muted: "#A1A1AA",
  disabled: "#8A8A94",
  brand: "#006FEE",
  onBrand: "#FFFFFF",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  info: "#2979FF",
  overlay: "rgba(0,0,0,0.6)",
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
    idle: t.foreground,
    recording: t.error,
    processing: t.warning,
    done: t.success,
    error: t.error,
  };
};
