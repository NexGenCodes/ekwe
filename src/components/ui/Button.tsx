import * as Haptics from 'expo-haptics';
import { Loader } from 'lucide-react-native';
import React, { useRef, useEffect } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { borderRadius } from '@/constants/designTokens';
import { fonts } from '@/constants/fonts';
import { useTheme } from '@/hooks';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large' | 'md';

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Button = ({
  label,
  variant = 'primary',
  size = 'medium',
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  onPress,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps): React.ReactElement => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const { color } = useTheme();

  useEffect(() => {
    if (!loading) {
      spinAnim.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return (): void => animation.stop();
  }, [loading, spinAnim]);

  const spinDeg = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handlePressIn = (): void => {
    if (disabled || loading) return;
    Animated.timing(scaleAnim, {
      toValue: 0.95,
      duration: 120,
      useNativeDriver: true,
    }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = (): void => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  interface VariantStyles {
    container: object;
    text: object;
    spinner: string;
  }

  interface SizeStyles {
    container: object;
    text: object;
  }

  const variantStyles = function (): VariantStyles {
    switch (variant) {
      case 'primary':
        return {
          container: { backgroundColor: color.primary },
          text: { color: color.onPrimary },
          spinner: color.onPrimary,
        };
      case 'secondary':
        return {
          container: { backgroundColor: color.card },
          text: { color: color.foreground },
          spinner: color.foreground,
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderColor: color.primary,
          },
          text: { color: color.primary },
          spinner: color.primary,
        };
      case 'ghost':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: color.muted },
          spinner: color.muted,
        };
    }
  };

  const sizeStyles = function (): SizeStyles {
    switch (size) {
      case 'small':
        return {
          container: {
            paddingVertical: 4,
            paddingHorizontal: 12,
            minHeight: 48,
          },
          text: { fontSize: 16, fontFamily: fonts.bodyMed },
        };
      case 'large':
        return {
          container: {
            paddingVertical: 16,
            paddingHorizontal: 24,
            minHeight: 56,
          },
          text: {
            fontSize: 18,
            lineHeight: 24,
            letterSpacing: -0.2,
            fontFamily: fonts.bodyBold,
          },
        };
      case 'medium':
      case 'md':
      default:
        return {
          container: {
            paddingVertical: 8,
            paddingHorizontal: 16,
            minHeight: 48,
          },
          text: { fontSize: 16, fontFamily: fonts.bodyMed },
        };
    }
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: borderRadius.xl,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: scaleAnim }],
        },
        variantStyles().container,
        sizeStyles().container,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={8}
    >
      {loading ? (
        <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
          <Loader
            size={size === 'small' ? 16 : 20}
            color={variantStyles().spinner}
            strokeWidth={2.5}
          />
        </Animated.View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {leftIcon && <View style={{ marginRight: 8 }}>{leftIcon}</View>}
          <Text
            style={[
              {
                textAlign: 'center',
              },
              variantStyles().text,
              sizeStyles().text,
              labelStyle,
            ]}
          >
            {label}
          </Text>
          {rightIcon && <View style={{ marginLeft: 8 }}>{rightIcon}</View>}
        </View>
      )}
    </AnimatedPressable>
  );
};
