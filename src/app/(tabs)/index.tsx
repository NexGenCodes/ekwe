import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { StatusBar } from 'expo-status-bar';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  cancelAnimation,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweWordmark } from '@/assets/icons/EkweWordmark';
import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { AccountAvatar } from '@/components';
import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { AudioCapture } from '@/services/AudioCapture';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';

  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const isBusy = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    setLiveTranscript(event.results[0]?.transcript || '');
  });

  const errorColor = useMemo(() => getColor('error', isDark), [isDark]);
  const cardColor = useMemo(() => getColor('card', isDark), [isDark]);
  const borderColor = useMemo(() => getColor('border', isDark), [isDark]);
  const primaryColor = useMemo(() => getColor('primary', isDark), [isDark]);

  // --- Animations (UI-thread driven) ---
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  // Metering sync safely decoupled from JS state to prevent re-creation loops
  useEffect(() => {
    // 1. Sync local isRecording state with AudioCapture status (e.g. for Auto-Stop)
    const unsubscribeStatus = AudioCapture.addStatusListener((status) => {
      if (status === 'stopped' && isRecording) {
        setIsRecording(false);
        stopPulse();
      }
    });

    if (!isRecording) {
      return unsubscribeStatus;
    }

    // 2. Subscribe directly to AudioCapture to bypass React renders for metering
    const unsubscribeMetering = AudioCapture.addListener((val) => {
      ringScale.value = withSpring(1 + val * 0.6, {
        damping: 12,
        stiffness: 300,
        mass: 0.3,
      });
      ringOpacity.value = withTiming(0.15 + val * 0.35, { duration: 16 });
    });

    return (): void => {
      unsubscribeStatus();
      unsubscribeMetering();
    };
  }, [isRecording, ringScale, ringOpacity]);

  const stopPulse = (): void => {
    cancelAnimation(ringScale);
    cancelAnimation(ringOpacity);
    ringScale.value = withTiming(1, { duration: 200 });
    ringOpacity.value = withTiming(0, { duration: 200 });
  };

  const handlePressIn = (): void => {
    if (isBusy.current) return;
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
    if (isBusy.current) return;
    isBusy.current = true;

    try {
      if (isRecording) {
        ExpoSpeechRecognitionModule.stop();
        const result = await AudioCapture.stopRecording();
        setIsRecording(false);
        stopPulse();

        if (result.ok) {
          router.push({
            pathname: '/result',
            params: {
              entryId: result.value.sessionId,
              uri: result.value.uri,
              transcript: liveTranscript,
              isLive: 'true',
            },
          });
        }
      } else {
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        const perm = await AudioCapture.requestPermission();
        if (!perm.ok) return;

        const sessionId = `rec_${Date.now()}`;
        const result = await AudioCapture.startRecording(sessionId);

        if (result.ok) {
          setIsRecording(true);
          setLiveTranscript('');
          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: true,
            contextualStrings: ['Ekwe'],
          });
          ringOpacity.value = withTiming(0.15, { duration: 100 });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert('Error', 'Failed to start recording. Please try again.');
        }
      }
    } finally {
      isBusy.current = false;
    }
  };

  const animatedMicStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <StatusBar style="auto" />

      {/* Header Bar */}
      <View className="h-[60px] flex-row items-center justify-between px-6 z-20">
        <EkweWordmark size={50} color={primaryColor} />
        <View className="flex-row items-center space-x-1">
          <AccountAvatar />
        </View>
      </View>

      <View className="flex-1 px-8">
        {/* Top Section: Text Content */}
        <View className="flex-[0.8] justify-center items-center">
          <Text className="text-[40px] tracking-tight leading-[48px] font-display text-foreground dark:text-foreground-dark mb-4 text-center">
            {isRecording
              ? liveTranscript
                ? liveTranscript
                : 'Listening...'
              : 'Transcribe'}
          </Text>
          <Text className="text-[17px] leading-[26px] font-body text-muted dark:text-muted-dark max-w-[300px] text-center opacity-80">
            {isRecording
              ? 'Tap the core again to stop and process your voice note.'
              : 'Share an audio file from another app, or tap below to record.'}
          </Text>
        </View>

        {/* Center Section: Animated Mic */}
        <View className="flex-1 items-center justify-center">
          <View className="w-[300px] h-[300px] items-center justify-center relative">
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
              className="absolute w-[220px] h-[220px] rounded-full border"
            />

            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              onPress={toggleRecording}
              className="z-10"
            >
              <Animated.View
                className="w-32 h-32 rounded-[64px] items-center justify-center shadow-lg"
                style={[
                  animatedMicStyle,
                  {
                    backgroundColor: isRecording
                      ? errorColor + '15'
                      : cardColor,
                    borderWidth: 1.5,
                    borderColor: isRecording ? errorColor : borderColor,
                  },
                ]}
              >
                <MicrophoneIcon
                  size={56}
                  color={isRecording ? errorColor : primaryColor}
                  strokeWidth={2.5}
                />
              </Animated.View>
            </Pressable>
          </View>
        </View>

        {/* Bottom Spacer for Balance */}
        <View className="flex-[0.4]" />
      </View>
    </SafeAreaView>
  );
}
