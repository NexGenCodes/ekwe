import { BlurView } from 'expo-blur';
import { Check, AlertTriangle, X, LucideIcon } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useTheme } from 'src/hooks/useTheme';

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
  const { tokens, id } = useTheme();

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
          color: tokens.color.status.success,
          Icon: Check,
        };
      case 'warning':
        return {
          color: tokens.color.status.warning,
          Icon: AlertTriangle,
        };
      case 'error':
        return {
          color: tokens.color.status.error,
          Icon: AlertTriangle,
        };
      case 'info':
      default:
        return {
          color: tokens.color.status.info,
          Icon: AlertTriangle,
        };
    }
  }, [variant, tokens]);

  if (!visible) return null;

  const { color, Icon } = variantConfig;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(15)}
      exiting={FadeOutUp}
      style={[
        styles.container,
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
          tint={id === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
          <Icon size={20} color={color} strokeWidth={2.5} />
        </View>

        <View style={styles.textContainer}>
          <Text
            style={[
              styles.title,
              {
                color: tokens.color.text.primary,
                fontFamily: tokens.font.family.bodyMed,
              },
            ]}
          >
            {title}
          </Text>
          {message && (
            <Text
              style={[
                styles.message,
                {
                  color: tokens.color.text.secondary,
                  fontFamily: tokens.font.family.body,
                },
              ]}
            >
              {message}
            </Text>
          )}
        </View>

        {onClose && (
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss banner"
          >
            <X
              size={20}
              color={tokens.color.text.secondary}
              strokeWidth={2.5}
            />
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

const styles = StyleSheet.create({
  container: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    borderCurve: 'continuous',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  closeButton: {
    marginLeft: 12,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
