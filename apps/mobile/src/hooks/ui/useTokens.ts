import { useMemo } from "react";

import { useTheme, type ThemeTokens } from "@/hooks/ui/useTheme";

import { duration, spring, scale } from "@/constants/motion";
import { shadows } from "@/constants/shadows";
import {
  borderRadius,
  iconSize,
  touchTarget,
  opacity,
  zIndex,
} from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";

export interface UseTokensReturn extends ThemeTokens {
  spacing: typeof spacing;
  typography: typeof typography;
  borderRadius: typeof borderRadius;
  iconSize: typeof iconSize;
  touchTarget: typeof touchTarget;
  opacity: typeof opacity;
  zIndex: typeof zIndex;
  shadows: typeof shadows;
  duration: typeof duration;
  spring: typeof spring;
  scale: typeof scale;
}

export const useTokens = (): UseTokensReturn => {
  const theme = useTheme();

  return useMemo(
    () => ({
      ...theme,
      spacing,
      typography,
      borderRadius,
      iconSize,
      touchTarget,
      opacity,
      zIndex,
      shadows,
      duration,
      spring,
      scale,
    }),
    [theme],
  );
};

export type Tokens = ReturnType<typeof useTokens>;
