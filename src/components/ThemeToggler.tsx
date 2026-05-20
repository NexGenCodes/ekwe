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
import { settingsActions, ThemePreference } from '@/store';

export interface ThemeTogglerProps {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const ThemeToggler = ({
  style,
  accessibilityLabel,
}: ThemeTogglerProps): React.ReactElement => {
  const { isDark, color } = useTheme();
  const { setThemePreference } = settingsActions;
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
      style={[
        style,
        {
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: isDark
            ? 'rgba(39, 39, 42, 0.8)'
            : 'rgba(228, 228, 231, 0.5)',
          backgroundColor: isDark
            ? 'rgba(9, 9, 11, 0.4)'
            : 'rgba(244, 244, 245, 0.8)',
        },
      ]}
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
          <Moon size={24} color={color.primary} strokeWidth={2.5} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};
