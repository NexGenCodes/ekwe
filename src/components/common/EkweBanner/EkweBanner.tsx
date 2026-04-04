import { BlurView } from 'expo-blur';
import { Check, AlertTriangle, X, LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect, useMemo } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { getColor } from 'src/constants/theme';

import { EkweBannerProps } from './EkweBanner.types';

export const EkweBanner = ({
  title,
  message,
  variant = 'info',
  visible,
  onClose,
  duration,
  style,
  accessibilityLabel,
}: EkweBannerProps): React.ReactElement | null => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect((): (() => void) | void => {
    if (visible && duration && onClose) {
      const timer = setTimeout(onClose, duration);
      return (): void => clearTimeout(timer);
    }
  }, [visible, duration, onClose]);

  const variantConfig = useMemo((): {
    color: string;
    Icon: LucideIcon;
  } => {
    switch (variant) {
      case 'success':
        return {
          color: getColor('success', isDark),
          Icon: Check,
        };
      case 'warning':
        return {
          color: getColor('warning', isDark),
          Icon: AlertTriangle,
        };
      case 'error':
        return {
          color: getColor('error', isDark),
          Icon: AlertTriangle,
        };
      case 'info':
      default:
        return {
          color: getColor('info', isDark),
          Icon: AlertTriangle,
        };
    }
  }, [variant, isDark]);

  if (!visible) return null;

  const { color, Icon } = variantConfig;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(15)}
      exiting={FadeOutUp}
      className="m-4 rounded-2xl border-[1px] overflow-hidden shadow-md"
      style={[
        {
          borderColor: `${color}40`,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : `${color}15`,
        },
        style,
      ]}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel || `${variant} banner: ${title}`}
    >
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={20}
          tint={isDark ? 'dark' : 'light'}
          className="absolute inset-0"
        />
      )}
      <View className="flex-row items-center p-3">
        <View
          className="w-9 h-9 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon size={20} color={color} strokeWidth={2.5} />
        </View>

        <View className="flex-1 justify-center">
          <Text className="text-base font-bodyMed mb-0.5 text-zinc-950 dark:text-zinc-50">
            {title}
          </Text>
          {message && (
            <Text className="text-sm font-body leading-5 text-zinc-600 dark:text-zinc-400">
              {message}
            </Text>
          )}
        </View>

        {onClose && (
          <Pressable
            onPress={onClose}
            hitSlop={12}
            className="ml-3 w-8 h-8 items-center justify-center active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel="Dismiss banner"
          >
            <X size={20} color={getColor('muted', isDark)} strokeWidth={2.5} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
};

export const BannerPresets = {
  noInternet: {
    variant: 'error' as const,
    title: 'No connection',
    message: 'Translations will resume once you are back online.',
  },
  offlineMode: {
    variant: 'warning' as const,
    title: 'Offline mode',
    message: 'Using on-device models only.',
  },
};
