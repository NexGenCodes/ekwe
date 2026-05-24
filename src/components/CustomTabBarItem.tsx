import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks';

interface TabBarIconProps {
  color: string;
  size: number;
  focused: boolean;
}

interface TabBarItemOptions {
  tabBarIcon?: (props: TabBarIconProps) => React.ReactNode;
  tabBarAccessibilityLabel?: string;
  tabBarTestID?: string;
}

interface CustomTabBarItemProps {
  isFocused: boolean;
  options: TabBarItemOptions;
  onPress: () => void;
  onLongPress: () => void;
  label: string;
}

export function CustomTabBarItem({
  isFocused,
  options,
  onPress,
  onLongPress,
  label,
}: CustomTabBarItemProps): React.ReactElement {
  const { color } = useTheme();

  // Single source of truth: 0 = inactive, 1 = active
  const progress = useSharedValue(isFocused ? 1 : 0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(isFocused ? 1 : 0, {
      damping: 18,
      stiffness: 200,
      mass: 0.6,
    });
  }, [isFocused, progress]);

  const handlePressIn = (): void => {
    pressScale.value = withTiming(0.93, { duration: 120 });
  };

  const handlePressOut = (): void => {
    pressScale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  // Outer container: flex expands to reveal label space
  const containerStyle = useAnimatedStyle(() => ({
    flex: interpolate(progress.value, [0, 1], [1, 1.6]),
    transform: [{ scale: pressScale.value }],
  }));

  // Pill background fades in using primary color at low opacity
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['transparent', `${color.primary}22`],
    ),
    paddingHorizontal: interpolate(progress.value, [0, 1], [12, 18]),
  }));

  // Icon gently scales up when active
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.1]) }],
  }));

  // Label slides in from left with a fade — delayed via 0.5 midpoint
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0, 1]),
    maxWidth: interpolate(progress.value, [0, 1], [0, 100]),
    marginLeft: interpolate(progress.value, [0, 1], [0, 8]),
  }));

  const Icon = options.tabBarIcon;
  const iconColor = isFocused ? color.primary : color.muted;

  return (
    <Animated.View
      style={[
        { alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
        containerStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        testID={options.tabBarTestID}
        onPress={() => {
          if (!isFocused) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          onPress();
        }}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{
          flex: 1,
          width: '100%',
          minHeight: 48,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Animated.View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 12,
              borderRadius: 9999,
            },
            pillStyle,
          ]}
        >
          {/* Icon with independent scale */}
          <Animated.View style={iconStyle}>
            {Icon && <Icon size={22} color={iconColor} focused={isFocused} />}
          </Animated.View>

          {/* Label slides in with overflow clipping */}
          <Animated.View style={[{ overflow: 'hidden' }, labelStyle]}>
            <Text
              style={{
                color: color.primary,
                fontFamily: 'Outfit-Bold',
                fontSize: 14,
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
