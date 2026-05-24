// Ekwe Design Tokens
// Spacing, typography, and sizing following 4px grid system

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const borderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

export const typography = {
  display: {
    size: 32,
    lineHeight: 38,
    weight: '700' as const,
    letterSpacing: -0.5,
  },
  heading1: {
    size: 28,
    lineHeight: 34,
    weight: '600' as const,
    letterSpacing: -0.3,
  },
  heading2: {
    size: 24,
    lineHeight: 30,
    weight: '600' as const,
    letterSpacing: -0.2,
  },
  heading3: {
    size: 20,
    lineHeight: 26,
    weight: '600' as const,
  },
  bodyLarge: {
    size: 18,
    lineHeight: 27,
    weight: '400' as const,
  },
  body: {
    size: 16,
    lineHeight: 24,
    weight: '400' as const,
  },
  bodySmall: {
    size: 14,
    lineHeight: 20,
    weight: '400' as const,
  },
  caption: {
    size: 12,
    lineHeight: 16,
    weight: '400' as const,
  },
  label: {
    size: 14,
    lineHeight: 20,
    weight: '500' as const,
    letterSpacing: 0.5,
  },
} as const;

export const touchTarget = {
  minimum: 44,
  comfortable: 48,
} as const;

export const iconSize = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

export const shadows = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 2,
  },
  softLg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
} as const;
