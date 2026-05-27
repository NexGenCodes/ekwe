export const borderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

export const iconSize = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

export const touchTarget = {
  minimum: 44,
  comfortable: 48,
} as const;

export const opacity = {
  disabled: 0.5,
  inactive: 0.6,
  scrim: 0.4,
  scrimDark: 0.6,
} as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  dropdown: 100,
  modal: 1000,
  toast: 2000,
} as const;

export const interaction = {
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
} as const;

export const spinnerSize = {
  sm: 16,
  md: 20,
  strokeWidth: 2.5,
} as const;

export type BorderRadiusKey = keyof typeof borderRadius;
export type IconSizeKey = keyof typeof iconSize;
export type TouchTargetKey = keyof typeof touchTarget;
export type OpacityKey = keyof typeof opacity;
export type ZIndexKey = keyof typeof zIndex;

