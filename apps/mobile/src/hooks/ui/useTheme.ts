import { useSelector } from "@legendapp/state/react";
import { useMemo, useCallback } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

import { getTheme, bubbleColors, palette } from "@/constants/colors";
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
  const systemColorScheme = useSystemColorScheme();
  // Read preference from Legend-State — ALL hook instances react to this simultaneously
  const preference = useSelector(() => settings$.themePreference.get()) as
    "light" | "dark" | "system";

  const resolvedScheme =
    preference === "system" ? systemColorScheme : preference;
  const isDark = resolvedScheme === "dark";

  // Stable reference: only recomputes when theme actually switches.
  const color = useMemo(
    () => ({
      ...getTheme(isDark),
      bubble: bubbleColors(isDark),
    }),
    [isDark],
  );

  // Shadow tokens never change — allocate once for the lifetime of the app.
  const shadow = useMemo(
    () => ({
      overlay: {
        shadowColor: palette.neutral950,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
    [],
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
