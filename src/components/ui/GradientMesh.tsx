import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks';

export const GradientMesh = (): React.JSX.Element => {
  const { color, isDark } = useTheme();
  
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  useEffect(() => {
    x.value = withRepeat(withSequence(withTiming(100, { duration: 5000 }), withTiming(0, { duration: 5000 })), -1);
    y.value = withRepeat(withSequence(withTiming(100, { duration: 7000 }), withTiming(0, { duration: 7000 })), -1);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="grad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%" stopColor={isDark ? `${color.primary}20` : `${color.primary}10`} />
            <Stop offset="100%" stopColor="transparent" />
          </RadialGradient>
        </Defs>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <Rect width="100%" height="100%" fill="url(#grad)" />
        </Animated.View>
      </Svg>
    </View>
  );
};
