import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { ThemeToggler } from 'src/components';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { getColor } from 'src/constants/theme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useHistoryStore } from 'src/store';
export const HomeScreen = ({
  navigation,
}: MainTabScreenProps<'Home'>): React.ReactElement => {
  const entries = useHistoryStore((s) => s.entries);

  const lastEntry = entries[0];
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // --- Animations ---
  const pulse = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 1500 }),
        withTiming(1, { duration: 1500 }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const animatedPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: interpolate(pulse.value, [1, 1.2], [0.4, 0], Extrapolate.CLAMP),
  }));

  const animatedMicStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (): void => {
    scale.value = withSpring(0.92, { damping: 15, stiffness: 300 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = (): void => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-zinc-950 dark:bg-black">
      <StatusBar style="light" />
      {/* Header Bar */}
      <View className="h-[60px] flex-row items-center justify-between px-6">
        <EkweWordmark size={50} color={getColor('onPrimary', isDark)} />
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            navigation.navigate('Settings');
          }}
          className="w-10 h-10 items-end justify-center active:bg-white/10 rounded-full"
        >
          <ThemeToggler />
        </Pressable>
      </View>

      <View className="flex-1 rounded-t-[32px] mt-2 overflow-hidden bg-background dark:bg-background-dark">
        {/* The Console (Hero Area) */}
        <View className="flex-[1.2] items-center justify-center">
          <View className="w-[200px] h-[200px] items-center justify-center mb-6 relative">
            {/* Pulsing Rings */}
            <Animated.View
              className="absolute w-[140px] h-[140px] rounded-full bg-primary dark:bg-primary-dark"
              style={animatedPulseStyle}
            />
            <Animated.View
              className="absolute w-[140px] h-[140px] rounded-full bg-primary dark:bg-primary-dark opacity-10"
              style={{ transform: [{ scale: 1.1 }] }}
            />

            {/* Main Mic Button */}
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              onPress={() => {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
                Alert.alert('Manual recording coming in Phase 5');
              }}
            >
              <Animated.View
                className="w-24 h-24 rounded-full items-center justify-center bg-card dark:bg-card-dark shadow-lg border border-white/20"
                style={animatedMicStyle}
              >
                <MicrophoneIcon
                  size={40}
                  color={getColor('primaryAccent', isDark)}
                  strokeWidth={2.5}
                />
              </Animated.View>
            </Pressable>
          </View>

          <Text className="text-[32px] text-center leading-[38px] font-display text-zinc-950 dark:text-zinc-50 mb-2">
            Ready to Translate
          </Text>
          <Text className="text-base text-center leading-[24px] font-body text-zinc-500 dark:text-zinc-400 px-10 max-w-[340px]">
            Share a voice note or use the floating bubble to begin.
          </Text>
        </View>

        {/* Recent Sneak-Peek */}
        <View className="flex-[0.8] px-6 pb-10 justify-end">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-xs uppercase tracking-widest font-bodyMed text-zinc-400 dark:text-zinc-500">
              LAST TRANSLATION
            </Text>
            <Pressable onPress={() => navigation.navigate('History')}>
              <Text className="text-sm font-bodyMed text-primary dark:text-primary-dark">
                View History
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
            <View className="h-20 items-center justify-center px-5 bg-card dark:bg-card-dark rounded-xl">
              <Text className="text-base text-center leading-[24px] font-body text-zinc-400 dark:text-zinc-500">
                Your recent activity will appear here.
              </Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};
