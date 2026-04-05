import * as Haptics from 'expo-haptics';
import { Loader } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { getColor } from 'src/constants/colors';

import { EkweButtonProps } from './EkweButton.types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedLoader = Animated.createAnimatedComponent(Loader);

export const EkweButton = ({
  label,
  variant = 'primary',
  size = 'medium',
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  onPress,
  style,
  className = '',
  labelStyle,
  labelClassName = '',
  accessibilityLabel,
}: EkweButtonProps): React.ReactElement => {
  const scale = useSharedValue(1);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Animated style for press feedback
  const animatedStyle = useAnimatedStyle(
    (): { transform: { scale: number }[] } => ({
      transform: [{ scale: scale.value }],
    }),
  );

  const handlePressIn = (): void => {
    if (!disabled && !loading) {
      scale.value = withTiming(0.97, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handlePressOut = (): void => {
    scale.value = withTiming(1, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
    });
  };

  // Resolve styles based on variant and size
  const variantStyles = useMemo(() => {
    switch (variant) {
      case 'primary':
        return {
          container: 'bg-primary',
          text: 'text-white',
          spinner: getColor('onPrimary', isDark),
        };
      case 'secondary':
        return {
          container: 'bg-card',
          text: 'text-foreground',
          spinner: getColor('foreground', isDark),
        };
      case 'outline':
        return {
          container: 'bg-transparent border-[1.5px] border-primary',
          text: 'text-primary',
          spinner: getColor('primary', isDark),
        };
      case 'ghost':
        return {
          container: 'bg-transparent',
          text: 'text-muted',
          spinner: getColor('muted', isDark),
        };
      default:
        return {
          container: 'bg-primary',
          text: 'text-white',
          spinner: getColor('onPrimary', isDark),
        };
    }
  }, [variant, isDark]);

  const sizeStyles = useMemo(() => {
    switch (size) {
      case 'small':
        return {
          container: 'py-1 px-3 min-h-[48px]',
          text: 'text-base', // Enforced 16px
        };
      case 'large':
        return {
          container: 'py-4 px-6 min-h-[56px]',
          text: 'text-[28px] leading-[34px] tracking-[-0.5px]',
        };
      case 'medium':
      default:
        return {
          container: 'py-2 px-4 min-h-[48px]',
          text: 'text-base',
        };
    }
  }, [size]);

  // Spinner rotation
  const rotation = useSharedValue(0);
  React.useEffect(() => {
    if (loading) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1, // infinite
        false, // no reverse
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = 0;
    }
  }, [loading]);

  const spinStyle = useAnimatedStyle(
    (): { transform: { rotate: string }[] } => ({
      transform: [{ rotate: `${rotation.value}deg` }],
    }),
  );

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[style, animatedStyle]}
      className={`flex-row items-center justify-center rounded-full ${variantStyles.container} ${sizeStyles.container} ${disabled ? 'opacity-50' : ''} ${className}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={8}
    >
      {loading ? (
        <AnimatedLoader
          size={size === 'small' ? 16 : 20}
          color={variantStyles.spinner}
          style={spinStyle}
          strokeWidth={2.5}
        />
      ) : (
        <View className="flex-row items-center">
          {leftIcon && <View className="mr-2">{leftIcon}</View>}
          <Text
            style={labelStyle}
            className={`text-center font-display ${variantStyles.text} ${sizeStyles.text} ${labelClassName}`}
          >
            {label}
          </Text>
          {rightIcon && <View className="ml-2">{rightIcon}</View>}
        </View>
      )}
    </AnimatedPressable>
  );
};
