const palette = {
  white: "#FFFFFF",
  neutral50: "#FAFAFA",
  neutral100: "#F4F4F5",

  neutral150: "#E4E4E7",
  neutral200: "#C8C8CE",
  neutral650: "#3F3F46",
  neutral400: "#A1A1AA",
  neutral450: "#8A8A94",
  neutral550: "#6E6E78",
  neutral600: "#5C5C66",
  neutral700: "#3A3A40",
  neutral800: "#27272A",
  neutral900: "#18181B",
  neutral950: "#09090B",

  blue400: "#2979FF",
  blue600: "#006FEE",

  green400: "#4ADE80",
  green700: "#15803D",

  amber400: "#FBBF24",
  amber800: "#92400E",

  rose400: "#F87171",
  rose700: "#D01358",

  overlayLight: "rgba(0, 0, 0, 0.4)",
  overlayDark: "rgba(0, 0, 0, 0.6)",
} as const;

export const lightColors = {
  foreground: palette.neutral950,
  background: palette.white,
  card: palette.neutral50,
  surface: palette.neutral100,
  border: palette.neutral200,
  handle: palette.neutral150,
  muted: palette.neutral600,
  disabled: palette.neutral550,
  brand: palette.blue600,
  onBrand: palette.white,
  success: palette.green700,
  warning: palette.amber800,
  error: palette.rose700,
  info: palette.blue400,
  shadow: palette.neutral950,
  overlay: palette.overlayLight,
} as const;

export const darkColors = {
  foreground: palette.neutral50,
  background: palette.neutral950,
  card: palette.neutral900,
  surface: palette.neutral800,
  border: palette.neutral700,
  handle: palette.neutral650,
  muted: palette.neutral400,
  disabled: palette.neutral450,
  brand: palette.blue600,
  onBrand: palette.white,
  success: palette.green400,
  warning: palette.amber400,
  error: palette.rose400,
  info: palette.blue400,
  shadow: palette.neutral950,
  overlay: palette.overlayDark,
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
