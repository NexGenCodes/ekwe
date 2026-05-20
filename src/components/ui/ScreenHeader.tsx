import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ChevronLeft, Settings, X } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

export interface ScreenHeaderProps {
  title: string;
  leftAction?: 'back' | 'none';
  rightAction?: 'settings' | 'close' | 'none';
  onBack?: () => void;
  onClose?: () => void;
}

export const ScreenHeader = ({
  title,
  leftAction = 'back',
  rightAction = 'none',
  onBack,
  onClose,
}: ScreenHeaderProps): React.JSX.Element => {
  const router = useRouter();
  const { color } = useTheme();

  const handleLeftAction = async () => {
    if (leftAction === 'none') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    }
  };

  const handleRightAction = async () => {
    if (rightAction === 'none') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (rightAction === 'settings') {
      router.push('/(tabs)/settings');
    } else if (rightAction === 'close') {
      if (onClose) {
        onClose();
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      style={[
        styles.header,
        { backgroundColor: color.background }, // Transparent by default, but let's ensure it matches background
      ]}
    >
      {/* Left Action */}
      {leftAction === 'back' && (
        <Pressable
          onPress={handleLeftAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.headerButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color={color.foreground} />
        </Pressable>
      )}

      {/* Title */}
      <Text style={[styles.headerTitle, { color: color.foreground }]}>
        {title}
      </Text>

      {/* Right Action */}
      {rightAction !== 'none' ? (
        <Pressable
          onPress={handleRightAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.headerButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={rightAction === 'settings' ? 'Settings' : 'Close'}
        >
          {rightAction === 'settings' && (
            <Settings size={22} color={color.foreground} />
          )}
          {rightAction === 'close' && <X size={24} color={color.foreground} />}
        </Pressable>
      ) : (
        leftAction !== 'none' && <View style={styles.headerButtonPlaceholder} />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  headerButtonPlaceholder: { width: 40, height: 40 },
  headerTitle: { fontFamily: 'Outfit-Medium', fontSize: 20 },
});
