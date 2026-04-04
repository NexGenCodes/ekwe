import { Check } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { getColor } from 'src/constants/theme';
import { OnboardingScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

const AUTO_NAV_DELAY = 2000;

export const AllSetScreen = ({
  navigation,
}: OnboardingScreenProps<'AllSet'>): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const wordmarkColor = getColor('muted', isDark);
  const setOnboardingCompleted = useSettingsStore(
    (s) => s.setOnboardingCompleted,
  );

  // Animations
  const checkScale = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(16);

  useEffect(() => {
    // Bouncy check entrance
    checkScale.value = withDelay(
      200,
      withSpring(1, { damping: 8, stiffness: 150 }),
    );

    // Text fade in
    contentOpacity.value = withDelay(400, withTiming(1, { duration: 500 }));
    contentTranslateY.value = withDelay(
      400,
      withSpring(0, { damping: 14, stiffness: 100 }),
    );
  }, [checkScale, contentOpacity, contentTranslateY]);

  // Auto-navigate to Home after delay
  useEffect(() => {
    const timer = setTimeout((): void => {
      goToHome();
    }, AUTO_NAV_DELAY);

    return (): void => clearTimeout(timer);
  }, []);

  const goToHome = (): void => {
    setOnboardingCompleted(true);
    navigation.replace('Main', {
      screen: 'MainTabs',
      params: { screen: 'Home' },
    });
  };

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <Pressable
        className="flex-1 items-center justify-center px-8"
        onPress={goToHome}
      >
        {/* Check circle */}
        <Animated.View
          className="w-24 h-24 rounded-full items-center justify-center bg-emerald-500 dark:bg-emerald-600"
          style={checkStyle}
        >
          <Check
            size={48}
            color={getColor('onPrimary', isDark)}
            strokeWidth={3}
          />
        </Animated.View>

        {/* Copy */}
        <Animated.View className="items-center mt-8" style={textStyle}>
          <Text className="text-[32px] text-center leading-[38px] font-display text-zinc-950 dark:text-zinc-50">
            You're all set!
          </Text>
          <Text className="text-base text-center leading-[24px] font-body text-zinc-500 dark:text-zinc-400 mt-3 max-w-[280px]">
            Your first translation is one tap away.
          </Text>
        </Animated.View>

        {/* Wordmark at bottom */}
        <Animated.View className="absolute bottom-12" style={textStyle}>
          <EkweWordmark size={32} color={wordmarkColor} />
        </Animated.View>
      </Pressable>
    </SafeAreaView>
  );
};
