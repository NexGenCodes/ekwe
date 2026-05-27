import { Monitor, Moon, Sun } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Pressable } from '@/components/ui';
import { spring } from '@/constants';
import { borderRadius } from '@/constants/sizes';
import { useTheme } from '@/hooks';
import { settingsActions, ThemePreference } from '@/store';
import { triggerHaptic } from '@/utils/haptics';

export interface ThemeTogglerProps {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const ThemeToggler = ({
  style,
  accessibilityLabel,
}: ThemeTogglerProps): React.ReactElement => {
  const { colorScheme, color } = useTheme();
  const { setThemePreference } = settingsActions;

  const transition = useSharedValue(
    colorScheme === 'system' ? 0 : colorScheme === 'light' ? 1 : 2,
  );

  useEffect(() => {
    transition.value = withSpring(
      colorScheme === 'system' ? 0 : colorScheme === 'light' ? 1 : 2,
      spring.smooth,
    );
  }, [colorScheme]);

  const handlePress = (): void => {
    let nextTheme = ThemePreference.Light;
    if (colorScheme === 'system') nextTheme = ThemePreference.Light;
    else if (colorScheme === 'light') nextTheme = ThemePreference.Dark;
    else nextTheme = ThemePreference.System;

    setThemePreference(nextTheme);
    triggerHaptic();
  };

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${transition.value * 120}deg` }],
  }));

  const sunStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === 'light' ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === 'light' ? 1 : 0.5, spring.smooth) },
    ],
    position: 'absolute',
  }));

  const moonStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === 'dark' ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === 'dark' ? 1 : 0.5, spring.smooth) },
    ],
    position: 'absolute',
  }));

  const systemStyle = useAnimatedStyle(() => ({
    opacity: withSpring(colorScheme === 'system' ? 1 : 0, spring.smooth),
    transform: [
      { scale: withSpring(colorScheme === 'system' ? 1 : 0.5, spring.smooth) },
    ],
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
          borderRadius: borderRadius['2xl'],
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: color.border,
          backgroundColor:
            colorScheme === 'dark' ? color.surface : color.background,
        },
      ]}
      accessibilityLabel={
        accessibilityLabel ||
        `Switch to ${colorScheme === 'dark' ? 'light' : 'dark'} mode`
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
        <Animated.View style={systemStyle}>
          <Monitor size={24} color={color.primary} strokeWidth={2.5} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};
