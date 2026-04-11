import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  withSpring,
  cancelAnimation,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweWordmark } from '@/assets/icons/EkweWordmark';
import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { ThemeToggler } from '@/components';
import { getColor } from '@/constants/colors';
import { useMetering } from '@/hooks';
import { AudioCapture } from '@/services/AudioCapture';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [isRecording, setIsRecording] = useState(false);

  // Pre-calculate colors for UI-thread safety
  const errorColor = useMemo(() => getColor('error', isDark), [isDark]);
  const cardColor = useMemo(() => getColor('card', isDark), [isDark]);
  const borderColor = useMemo(() => getColor('border', isDark), [isDark]);
  const primaryColor = useMemo(() => getColor('primary', isDark), [isDark]);

  // --- Live metering from react-native-audio-api ---
  const liveAmplitude = useMetering();

  // --- Animations (UI-thread driven) ---
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  // Drive ring animation from live audio metering on UI thread.
  // When recording, the ring pulses in sync with actual voice levels.
  useAnimatedReaction(
    () => liveAmplitude.value,
    (val) => {
      if (isRecording) {
        // Scale ring 1.0-1.6 based on amplitude, snappy spring
        ringScale.value = withSpring(1 + val * 0.6, {
          damping: 12,
          stiffness: 300,
          mass: 0.3,
        });
        // Opacity 0.15-0.5 based on amplitude
        ringOpacity.value = withTiming(0.15 + val * 0.35, { duration: 16 });
      }
    },
    [isRecording],
  );

  const animatedMicStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const stopPulse = (): void => {
    cancelAnimation(ringScale);
    cancelAnimation(ringOpacity);
    ringScale.value = withTiming(1, { duration: 200 });
    ringOpacity.value = withTiming(0, { duration: 200 });
  };

  const handlePressIn = (): void => {
    scale.value = withSpring(0.95, {
      damping: 15,
      stiffness: 300,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = (): void => {
    scale.value = withSpring(1, {
      damping: 15,
      stiffness: 300,
    });
  };

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      // Stop recording
      const result = await AudioCapture.stopRecording();
      setIsRecording(false);
      stopPulse();

      if (result.ok) {
        router.push({
          pathname: '/result',
          params: {
            entryId: result.value.sessionId,
            isLive: 'true',
          },
        });
      }
    } else {
      // JIT Permission Check (Centralized in AudioCapture)
      const perm = await AudioCapture.requestPermission();
      if (!perm.ok) return;

      // Start recording
      const sessionId = `rec_${Date.now()}`;
      const result = await AudioCapture.startRecording(sessionId, () => {});

      if (result.ok) {
        setIsRecording(true);
        // Initial ring state — metering will take over immediately via useAnimatedReaction
        ringOpacity.value = withTiming(0.15, { duration: 100 });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Error', 'Failed to start recording. Please try again.');
      }
    }
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header Bar */}
      <View className="h-[60px] flex-row items-center justify-between px-6 z-20">
        <EkweWordmark size={50} color={primaryColor} />
        <View className="flex-row items-center space-x-1">
          <Pressable
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/settings');
            }}
            className="w-12 h-12 items-center justify-center rounded-full active:scale-90 transition-transform"
          >
            <ThemeToggler />
          </Pressable>
        </View>
      </View>

      <View className="flex-1 px-6 justify-center items-center pb-20 relative">
        {/* Texts moved to center above mic */}
        <View className="absolute top-[8%] items-center text-center">
          <Text className="text-[34px] tracking-tight leading-[42px] font-display text-foreground dark:text-foreground-dark mb-3 text-center">
            {isRecording ? 'Listening...' : 'Transcribe'}
          </Text>
          <Text className="text-base leading-[24px] font-body text-muted dark:text-muted-dark max-w-[280px] text-center">
            {isRecording
              ? 'Tap the core again to stop and process your voice note.'
              : 'Share an audio file from another app, or tap below to record.'}
          </Text>
        </View>

        {/* Huge Console Mic Center */}
        <View className="w-[300px] h-[300px] items-center justify-center relative z-10">
          <Animated.View
            style={[
              animatedRingStyle,
              {
                backgroundColor: isRecording
                  ? errorColor + '15'
                  : primaryColor + '10',
                borderColor: isRecording
                  ? errorColor + '30'
                  : primaryColor + '20',
              },
            ]}
            className="absolute w-[200px] h-[200px] rounded-full border"
          />

          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={toggleRecording}
            className="z-10 outline-none"
          >
            <Animated.View
              className="w-32 h-32 rounded-[64px] items-center justify-center shadow-sm"
              style={[
                animatedMicStyle,
                {
                  backgroundColor: isRecording ? errorColor + '15' : cardColor,
                  borderWidth: 1.5,
                  borderColor: isRecording ? errorColor : borderColor,
                },
              ]}
            >
              <MicrophoneIcon
                size={56}
                color={isRecording ? errorColor : primaryColor}
                strokeWidth={2}
              />
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
