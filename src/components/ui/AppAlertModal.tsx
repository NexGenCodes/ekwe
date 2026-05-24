import { useSelector } from '@legendapp/state/react';
import { BlurView } from 'expo-blur';
import { AlertCircle, CheckCircle, Info, Trash2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

import { spacing, typography } from '@/constants/designTokens';
import { useTheme } from '@/hooks';
import { appAlert$, appAlertActions, AlertType } from '@/store';

const ICON_MAP = {
  info: Info,
  success: CheckCircle,
  error: AlertCircle,
  confirm: Trash2, // Or a warning icon depending on context
};

export function AppAlertModal(): React.JSX.Element | null {
  const { color, isDark } = useTheme();
  const { width } = useWindowDimensions();

  // Subscribe to the global alert state
  const state = useSelector(() => appAlert$.get());
  const { isVisible, type, title, message, buttons, cancelable } = state;

  // Render the correct icon based on type
  const IconComponent = ICON_MAP[type] || Info;
  const iconColor =
    type === 'error' || type === 'confirm'
      ? color.error
      : type === 'success'
        ? color.primary
        : color.primary;

  const handleClose = (): void => {
    if (cancelable) {
      appAlertActions.hide();
    }
  };

  const handleButtonPress = (onPress?: () => void): void => {
    appAlertActions.hide();
    if (onPress) {
      // Small delay to let the modal close animation start
      setTimeout(onPress, 100);
    }
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View
        style={styles.backdrop}
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(200)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessible={false}
        />
        <BlurView
          intensity={isDark ? 20 : 10}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          entering={ZoomIn.duration(250).springify().damping(18).stiffness(200)}
          exiting={ZoomOut.duration(200)}
          style={[
            styles.alertBox,
            {
              backgroundColor: color.surface,
              borderColor: color.border,
              width: Math.min(width - spacing[8] * 2, 400),
            },
          ]}
        >
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: isDark ? color.border : color.background },
              ]}
            >
              <IconComponent size={28} color={iconColor} strokeWidth={2.5} />
            </View>
            <Text style={[styles.title, { color: color.foreground }]}>{title}</Text>
            {message && (
              <Text style={[styles.message, { color: color.muted }]}>
                {message}
              </Text>
            )}
          </View>

          <View
            style={[
              styles.buttonContainer,
              // If there are exactly two buttons, put them side by side
              buttons?.length === 2 && styles.buttonContainerRow,
            ]}
          >
            {buttons?.map((btn, idx) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              const isPrimary = !isDestructive && !isCancel;

              return (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    styles.button,
                    isPrimary && { backgroundColor: color.primary },
                    isDestructive && { backgroundColor: color.error },
                    isCancel && {
                      backgroundColor: 'transparent',
                      borderWidth: 1,
                      borderColor: color.border,
                    },
                    pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                    buttons.length === 2 && { flex: 1 },
                  ]}
                  onPress={() => handleButtonPress(btn.onPress)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      (isPrimary || isDestructive) && {
                        color: color.onPrimary,
                      },
                      isCancel && { color: color.foreground },
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBox: {
    borderRadius: 24,
    padding: spacing[6],
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing[6],
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontFamily: 'Outfit-Bold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  message: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.body.size,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'column',
    gap: spacing[3],
  },
  buttonContainerRow: {
    flexDirection: 'row',
  },
  button: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  buttonText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 16,
  },
});
