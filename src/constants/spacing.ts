export const spacing = {
  hairline: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 40,
  '3xl': 48,
  '4xl': 56,
  '5xl': 64,
  '6xl': 80,
  '7xl': 96,
} as const;

export type SpacingKey = keyof typeof spacing;
