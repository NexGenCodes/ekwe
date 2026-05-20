import * as Haptics from 'expo-haptics';
import { Loader } from 'lucide-react-native';
import React, { useRef, useState, useEffect } from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { fonts } from '@/constants/fonts';
import { useTheme } from '@/hooks';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

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
  const [spinDeg, setSpinDeg] = useState(0);
  const { color } = useTheme();

  useEffect(() => {
    if (!loading) {
      setSpinDeg(0);
      return;
    }
    const interval = setInterval(() => {
      setSpinDeg((prev) => (prev + 360) % 360);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  const handlePressIn = (): void => {
    if (disabled || loading) return;
    Animated.timing(scaleAnim, {
      toValue: 0.97,
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

  const variantStyles = (() => {
    switch (variant) {
      case 'primary':
        return {
          container: { backgroundColor: color.primary },
          text: { color: '#ffffff' },
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
  })();

  const sizeStyles = (() => {
    switch (size) {
      case 'small':
        return {
          container: { paddingVertical: 4, paddingHorizontal: 12, minHeight: 48 },
          text: { fontSize: 16 },
        };
      case 'large':
        return {
          container: { paddingVertical: 16, paddingHorizontal: 24, minHeight: 56 },
          text: { fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
        };
      case 'medium':
      default:
        return {
          container: { paddingVertical: 8, paddingHorizontal: 16, minHeight: 48 },
          text: { fontSize: 16 },
        };
    }
  })();

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
          borderRadius: 9999,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: scaleAnim }],
        },
        variantStyles.container,
        sizeStyles.container,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      hitSlop={8}
    >
      {loading ? (
        <Animated.View style={{ transform: [{ rotate: `${spinDeg}deg` }] }}>
          <Loader
            size={size === 'small' ? 16 : 20}
            color={variantStyles.spinner}
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
                fontFamily: fonts.bodyMed,
              },
              variantStyles.text,
              sizeStyles.text,
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
