import * as Haptics from 'expo-haptics';
import { Moon, Sun } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks';
import { useSettingsStore } from '@/store';
import { ThemePreference } from '@/store/settingsSlice';


export interface ThemeTogglerProps {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}



export const ThemeToggler = ({
  style,
  accessibilityLabel,
}: ThemeTogglerProps): React.ReactElement => {
  const { isDark, color } = useTheme();
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);
  const transition = useSharedValue(isDark ? 1 : 0);

  useEffect(() => {
    transition.value = withSpring(isDark ? 1 : 0, {
      damping: 15,
      stiffness: 300,
    });
  }, [isDark]);

  const handlePress = (): void => {
    const nextTheme = isDark ? ThemePreference.Light : ThemePreference.Dark;
    setThemePreference(nextTheme);
    Haptics.selectionAsync();
  };

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${transition.value * 180}deg` }],
  }));

  const sunStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isDark ? 1 : 0),
    transform: [{ scale: withSpring(isDark ? 1 : 0.5) }],
    position: 'absolute',
  }));

  const moonStyle = useAnimatedStyle(() => ({
    opacity: withSpring(!isDark ? 1 : 0),
    transform: [{ scale: withSpring(!isDark ? 1 : 0.5) }],
    position: 'absolute',
  }));

  return (
    <Pressable
      onPress={handlePress}
      style={style}
      className="w-12 h-12 rounded-full items-center justify-center border border-zinc-200/50 dark:border-zinc-800/80 bg-zinc-100/80 dark:bg-zinc-950/40 active:scale-95 transition-all duration-200 ease-in-out"
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || `Switch to ${isDark ? 'light' : 'dark'} mode`
      }
    >
      <Animated.View
        style={[iconStyle, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <Animated.View style={sunStyle}>
          <Sun size={24} color={color.primary} strokeWidth={2.5} />
        </Animated.View>
        <Animated.View style={moonStyle}>
          <Moon
            size={24}
            color={color.primary}
            strokeWidth={2.5}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};
