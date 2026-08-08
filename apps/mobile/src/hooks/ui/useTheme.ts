import { useSelector } from "@legendapp/state/react";
import { useMemo, useCallback, useEffect, useState } from "react";
import { Appearance, AppState, useColorScheme as useSystemColorScheme } from "react-native";

import { getTheme, bubbleColors } from "@/constants/colors";
import type { ColorsKey } from "@/constants/colors";
import { settings$, ThemePreference } from "@/store/settings";
import { isAndroid } from "@/utils/platform";
import EkweNative from "../../../modules/ekwe-native";

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
  // Reactive system scheme. In the MAIN app this updates live on Appearance
  // change. Inside the Android ShareActivity overlay RN's Appearance cache can
  // go stale (it only refreshes once the main app foregrounds), so on Android we
  // additionally read the authoritative UiMode via the native module and prefer
  // it over the reactive value.
  const reactiveScheme = useSystemColorScheme();
  const [systemScheme, setSystemScheme] = useState(reactiveScheme);

  // Live Appearance changes win everywhere EXCEPT Android, where the overlay-
  // safe native value is authoritative (see below).
  useEffect(() => {
    if (!isAndroid) setSystemScheme(reactiveScheme);
  }, [reactiveScheme]);

  useEffect(() => {
    if (!isAndroid) return;
    const refresh = (): void => {
      try {
        const native = EkweNative.getSystemTheme();
        if (native === "light" || native === "dark") setSystemScheme(native);
      } catch {
        // Native theme unavailable — fall back to the reactive Appearance value.
      }
    };
    // Resolve once at mount (fresh UiMode read bypasses the stale cache) and
    // again whenever we return to the foreground after a device theme change.
    refresh();
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    const appearanceSub = Appearance.addChangeListener(() => {
      // A genuine Appearance event is still reacted to on Android; re-read the
      // authoritative native value so the overlay recolors immediately.
      refresh();
    });
    return (): void => {
      appStateSub.remove();
      appearanceSub.remove();
    };
  }, []);

  // Read preference from Legend-State — ALL hook instances react to this simultaneously
  const preference = useSelector(() => settings$.themePreference.get()) as
    "light" | "dark" | "system";

  const resolvedScheme =
    preference === "system" ? systemScheme : preference;
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
