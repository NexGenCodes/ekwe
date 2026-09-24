import { useValue } from "@legendapp/state/react";
import { useMemo, useCallback } from "react";

import { useSystemScheme } from "@/hooks/ui/systemScheme";

import { getTheme, bubbleColors } from "@/constants/colors";
import type { ColorsKey } from "@/constants/colors";
import { settings$, ThemePreference } from "@/store/settings";

type ThemeColor = Record<ColorsKey, string> & {
  bubble: {
    idle: string;
    recording: string;
    processing: string;
    done: string;
    error: string;
  };
};

export interface ThemeTokens {
  colorScheme: "light" | "dark" | "system";
  setColorScheme: (scheme: "light" | "dark" | "system") => void;
  color: ThemeColor;
  shadow: {
    overlay: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  isDark: boolean;
}

export const useTheme = (): ThemeTokens => {
  const systemScheme = useSystemScheme();

  const preference = useValue(() => settings$.themePreference.get()) as
    "light" | "dark" | "system";

  const resolvedScheme = preference === "system" ? systemScheme : preference;
  const isDark = resolvedScheme === "dark";

  const color = useMemo(
    () => ({
      ...getTheme(isDark),
      bubble: bubbleColors(isDark),
    }),
    [isDark],
  );

  const shadow = useMemo(
    () => ({
      overlay: {
        shadowColor: color.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
    [color],
  );

  const setColorScheme = useCallback((scheme: "light" | "dark" | "system") => {
    settings$.themePreference.set(scheme as ThemePreference);
  }, []);

  return useMemo(
    () => ({
      colorScheme: preference,
      setColorScheme,
      isDark,
      color,
      shadow,
    }),
    [preference, setColorScheme, isDark, color, shadow],
  );
};
