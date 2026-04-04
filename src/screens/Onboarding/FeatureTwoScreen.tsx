import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { ShieldCheck, Lock } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect, useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';
import { PageDots } from 'src/components/common/PageDots';
import { getColor } from 'src/constants/theme';
import { OnboardingScreenProps } from 'src/navigation/types';

export const FeatureTwoScreen = ({
  navigation,
}: OnboardingScreenProps<'FeatureTwo'>): React.ReactElement => {
  const [micDenied, setMicDenied] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const iconColor = getColor('primaryAccent', isDark);

  // Entrance animation
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(24);
  const shieldScale = useSharedValue(0.8);

  useEffect(() => {
    contentOpacity.value = withTiming(1, { duration: 600 });
    contentTranslateY.value = withSpring(0, { damping: 14, stiffness: 100 });
    shieldScale.value = withDelay(
      300,
      withSpring(1, { damping: 10, stiffness: 120 }),
    );
  }, [contentOpacity, contentTranslateY, shieldScale]);

  // Auto-request mic permission on mount
  useEffect(() => {
    const requestMic = async (): Promise<void> => {
      const current = await getRecordingPermissionsAsync();
      if (current.granted) {
        setMicGranted(true);
        return;
      }
      const result = await requestRecordingPermissionsAsync();
      if (result.granted) {
        setMicGranted(true);
      } else {
        setMicDenied(true);
      }
    };

    // Small delay so the screen renders first before the OS dialog
    const timer = setTimeout(requestMic, 800);
    return (): void => clearTimeout(timer);
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const shieldStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shieldScale.value }],
  }));

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <Animated.View
        className="flex-1 items-center justify-center px-8"
        style={contentStyle}
      >
        {/* Hero */}
        <View className="relative items-center justify-center -translate-y-4">
          <Animated.View
            className="w-24 h-24 rounded-full items-center justify-center bg-card dark:bg-card-dark border border-zinc-200 dark:border-zinc-800 shadow-sm"
            style={shieldStyle}
          >
            <ShieldCheck size={40} color={iconColor} strokeWidth={2} />
          </Animated.View>

          <View className="absolute -top-3 right-0 w-8 h-8 rounded-full bg-background dark:bg-background-dark items-center justify-center shadow-lg border border-zinc-200 dark:border-zinc-800">
            <Lock size={14} color={iconColor} strokeWidth={2.5} />
          </View>
        </View>

        {/* Copy */}
        <Text className="text-[32px] text-center leading-[38px] font-display text-zinc-950 dark:text-zinc-50 mt-10">
          Private by design
        </Text>
        <Text className="text-base text-center leading-[24px] font-body text-zinc-500 dark:text-zinc-400 mt-3 max-w-[300px]">
          All audio is processed on-device and never stored. Your conversations
          stay yours — always.
        </Text>

        {/* Mic status feedback */}
        {micDenied && (
          <Pressable
            onPress={() => Linking.openSettings()}
            className="w-full items-center py-3 px-5 rounded-xl bg-rose-500/10 border border-rose-500/20 mt-6"
          >
            <Text className="text-center font-body text-base text-rose-600 dark:text-rose-500">
              Mic access denied.{' '}
              <Text className="text-primary dark:text-primary-dark font-bodyMed">
                Open Settings →
              </Text>
            </Text>
          </Pressable>
        )}

        {micGranted && (
          <View className="w-full items-center py-3 px-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mt-6">
            <Text className="text-center font-body text-base text-emerald-600 dark:text-emerald-400">
              ✓ Microphone enabled
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Bottom */}
      <View className="w-full items-center px-8 pb-10">
        <PageDots total={2} active={1} />
        <View className="w-full mt-6">
          <EkweButton
            variant="primary"
            size="large"
            label="Continue"
            onPress={() => navigation.navigate('Language')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
