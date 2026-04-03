import * as Haptics from 'expo-haptics';
import { Loader } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  cancelAnimation,
} from 'react-native-reanimated';
import { useTheme } from 'src/hooks/useTheme';

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
  labelStyle,
  accessibilityLabel,
}: EkweButtonProps): React.ReactElement => {
  const { tokens } = useTheme();
  const scale = useSharedValue(1);

  // Animated style for press feedback
  const animatedStyle = useAnimatedStyle(
    (): { transform: { scale: number }[] } => ({
      transform: [{ scale: scale.value }],
    }),
  );

  const handlePressIn = (): void => {
    if (!disabled && !loading) {
      scale.value = withSpring(0.97, { damping: 10, stiffness: 300 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handlePressOut = (): void => {
    scale.value = withSpring(1, { damping: 10, stiffness: 300 });
  };

  // Resolve styles based on variant and size
  const variantStyles = useMemo((): {
    container: {
      backgroundColor: string;
      borderWidth: number;
      borderColor?: string;
    };
    text: { color: string };
  } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: tokens.color.brand.core,
            borderWidth: 0,
          },
          text: { color: tokens.color.text.inverse },
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: tokens.color.background.secondary,
            borderWidth: 0,
          },
          text: { color: tokens.color.text.primary },
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderColor: tokens.color.brand.core,
          },
          text: { color: tokens.color.brand.core },
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 0,
          },
          text: { color: tokens.color.text.secondary },
        };
      default:
        return {
          container: {
            backgroundColor: tokens.color.brand.core,
            borderWidth: 0,
          },
          text: { color: tokens.color.text.inverse },
        };
    }
  }, [variant, tokens]);

  const sizeStyles = useMemo((): {
    container: {
      paddingVertical: number;
      paddingHorizontal: number;
      minHeight: number;
    };
    text: { fontSize: number };
  } => {
    switch (size) {
      case 'small':
        return {
          container: {
            paddingVertical: tokens.space[1],
            paddingHorizontal: tokens.space[3],
            minHeight: 44,
          },
          text: { fontSize: tokens.font.size.label },
        };
      case 'large':
        return {
          container: {
            paddingVertical: tokens.space[4],
            paddingHorizontal: tokens.space[6],
            minHeight: 56,
          },
          text: { fontSize: tokens.font.size.heading },
        };
      case 'medium':
      default:
        return {
          container: {
            paddingVertical: tokens.space[2],
            paddingHorizontal: tokens.space[4],
            minHeight: 48,
          },
          text: { fontSize: tokens.font.size.body },
        };
    }
  }, [size, tokens]);

  // Spinner rotation
  const rotation = useSharedValue(0);
  React.useEffect(() => {
    if (loading) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000 }),
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
      style={[
        styles.base,
        variantStyles.container,
        sizeStyles.container,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={8}
    >
      {loading ? (
        <AnimatedLoader
          size={size === 'small' ? 16 : 20}
          color={variantStyles.text.color}
          style={spinStyle}
          strokeWidth={2.5}
        />
      ) : (
        <View style={styles.content}>
          {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
          <Text
            style={[
              styles.label,
              variantStyles.text,
              sizeStyles.text,
              { fontFamily: tokens.font.family.display },
              labelStyle,
            ]}
          >
            {label}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </View>
      )}
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
  disabled: {
    opacity: 0.5,
  },
});
