import { palette } from "./colors";

export const shadows = {
  soft: {
    shadowColor: palette.neutral950,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 1,
  },
  softLg: {
    shadowColor: palette.neutral950,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
} as const;

export type ShadowKey = keyof typeof shadows;
