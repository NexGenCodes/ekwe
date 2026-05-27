import { palette } from './colors';

export const shadows = {
  soft: {
    shadowColor: palette.neutral950,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 2,
  },
  softLg: {
    shadowColor: palette.neutral950,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 4,
  },
} as const;

export type ShadowKey = keyof typeof shadows;
