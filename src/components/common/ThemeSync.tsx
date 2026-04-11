import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

import { useSettingsStore } from '@/store';
import { ThemePreference } from '@/store/settingsSlice';

/**
 * ThemeSync manages the synchronization between the user's persistent
 * theme preference and the NativeWind color scheme.
 *
 * It ensures that "System" mode correctly follows the OS,
 * while "Light" and "Dark" preferences force the scheme.
 */
export const ThemeSync = (): null => {
  const { setColorScheme } = useColorScheme();
  const themePreference = useSettingsStore((s) => s.themePreference);

  useEffect(() => {
    switch (themePreference) {
      case ThemePreference.Light:
        setColorScheme('light');
        break;
      case ThemePreference.Dark:
        setColorScheme('dark');
        break;
      case ThemePreference.System:
        setColorScheme('system');
        break;
      default:
        setColorScheme('system');
    }
  }, [themePreference, setColorScheme]);

  return null;
};
