import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { ThemeToggler } from 'src/components';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { getColor } from 'src/constants/colors';
import { MainTabScreenProps } from 'src/navigation/types';
import { AudioCapture } from 'src/services/AudioCapture';
import { useHistoryStore } from 'src/store';

export const HomeScreen = ({
  navigation,
}: MainTabScreenProps<'Home'>): React.ReactElement => {
  const entries = useHistoryStore((s) => s.entries);
  const lastEntry = entries[0];
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [isRecording, setIsRecording] = useState(false);

  // --- Animations ---
  const scale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0.2);

  const animatedMicStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: isRecording
      ? getColor('error', isDark) + '20' // 20% opacity red
      : getColor('card', isDark),
    borderColor: isRecording
      ? getColor('error', isDark)
      : getColor('border', isDark),
  }));

  const animatedRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const startPulse = (): void => {
    ringScale.value = withRepeat(
      withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 1200 }),
        withTiming(0, { duration: 1200 }),
      ),
      -1,
      false,
    );
  };

  const stopPulse = (): void => {
    cancelAnimation(ringScale);
    cancelAnimation(ringOpacity);
    ringScale.value = withTiming(1, { duration: 200 });
    ringOpacity.value = withTiming(0.2, { duration: 200 });
  };

  const handlePressIn = (): void => {
    scale.value = withTiming(0.95, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = (): void => {
    scale.value = withTiming(1, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
  };

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      // Stop recording
      const result = await AudioCapture.stopRecording();
      setIsRecording(false);
      stopPulse();

      if (result.ok) {
        navigation.navigate('Result', {
          entryId: result.value.sessionId,
          isLive: true,
        });
      }
    } else {
      // JIT Permission Check
      const perm = await AudioCapture.requestPermission();
      if (!perm.ok) {
        Alert.alert(
          'Microphone Access',
          'Ekwe needs microphone access to translate your voice notes. Please enable it in Settings.',
          [{ text: 'OK' }],
        );
        return;
      }

      // Start recording
      const sessionId = `rec_${Date.now()}`;
      const result = await AudioCapture.startRecording(sessionId, () => {});

      if (result.ok) {
        setIsRecording(true);
        startPulse();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Error', 'Failed to start recording. Please try again.');
      }
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header Bar */}
      <View className="h-[60px] flex-row items-center justify-between px-6">
        <EkweWordmark size={50} color={getColor('primary', isDark)} />
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            navigation.navigate('Settings');
          }}
          className="w-10 h-10 items-end justify-center rounded-full"
        >
          <ThemeToggler />
        </Pressable>
      </View>

      <View className="flex-1 overflow-hidden px-6 pt-4 justify-between pb-8">
        {/* Top Content */}
        <View className="flex-[0.65] justify-start mt-6">
          <Text className="text-[32px] leading-[38px] font-display text-foreground mb-3">
            {isRecording ? 'Listening...' : 'Ready to Translate'}
          </Text>
          <Text className="text-base leading-[24px] font-body text-muted mb-10 max-w-[340px]">
            {isRecording
              ? 'Tap the core again to stop and process your voice note.'
              : 'Share a voice note from another app, or tap below to record.'}
          </Text>

          <View className="flex-row justify-between items-center mb-5">
            <Text className="text-base uppercase tracking-widest font-bodyMed text-muted">
              RECENT ACTIVITY
            </Text>
            <Pressable
              onPress={() => navigation.navigate('History')}
              className="active:opacity-70 p-2 -mr-2"
            >
              <Text className="text-base font-bodyMed text-primary">
                History
              </Text>
            </Pressable>
          </View>

          {lastEntry ? (
            <HistoryItem
              entry={lastEntry}
              onPress={() =>
                navigation.navigate('Result', { entryId: lastEntry.id })
              }
              onDelete={() =>
                useHistoryStore.getState().deleteEntry(lastEntry.id)
              }
            />
          ) : (
            <View className="h-28 items-center justify-center px-6 bg-card rounded-[20px] border border-border">
              <Text className="text-base text-center leading-[24px] font-body text-muted">
                Your translation history will appear here.
              </Text>
            </View>
          )}
        </View>

        {/* Thumb Zone Core */}
        <View className="flex-[0.35] items-center justify-end relative">
          <View className="w-[200px] h-[200px] items-center justify-center relative">
            {/* Visual Ring (Animated if recording) */}
            <Animated.View
              style={animatedRingStyle}
              className="absolute w-[120px] h-[120px] rounded-full bg-primary/20 border border-primary/30"
            />

            {/* Main Mic Button */}
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              onPress={toggleRecording}
              className="z-10"
            >
              <Animated.View
                className="w-24 h-24 rounded-full items-center justify-center bg-card border border-border shadow-soft"
                style={animatedMicStyle}
              >
                <MicrophoneIcon
                  size={42}
                  color={
                    isRecording
                      ? getColor('error', isDark)
                      : getColor('primary', isDark)
                  }
                  strokeWidth={2.5}
                />
              </Animated.View>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};
