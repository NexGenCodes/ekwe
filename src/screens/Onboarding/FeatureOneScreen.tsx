import { Mic, Waves } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';
import { PageDots } from 'src/components/common/PageDots';
import { getColor } from 'src/constants/theme';
import { OnboardingScreenProps } from 'src/navigation/types';

export const FeatureOneScreen = ({
  navigation,
}: OnboardingScreenProps<'FeatureOne'>): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const iconColor = getColor('primaryAccent', isDark);

  // Entrance animation
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(24);

  // Pulse animation for mic icon
  const pulse = useSharedValue(1);

  useEffect(() => {
    contentOpacity.value = withTiming(1, { duration: 600 });
    contentTranslateY.value = withSpring(0, { damping: 14, stiffness: 100 });

    pulse.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1200 }),
        withTiming(1, { duration: 1200 }),
      ),
      -1,
      false,
    );
  }, [contentOpacity, contentTranslateY, pulse]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const pulseRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: interpolate(pulse.value, [1, 1.15], [0.3, 0], Extrapolate.CLAMP),
  }));

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <Animated.View
        className="flex-1 items-center justify-center px-8"
        style={contentStyle}
      >
        {/* Hero Illustration */}
        <View className="w-40 h-40 items-center justify-center mb-12 relative">
          <Animated.View
            className="absolute w-[140px] h-[140px] rounded-full bg-primary dark:bg-primary-dark"
            style={pulseRingStyle}
          />
          <View className="w-24 h-24 rounded-full items-center justify-center bg-card dark:bg-card-dark border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <Mic size={40} color={iconColor} strokeWidth={2} />
          </View>

          {/* Wave decorations */}
          <Animated.View className="absolute left-[-12px] top-1/2 -mt-[14px]">
            <Waves
              size={28}
              color={iconColor}
              strokeWidth={1.5}
              opacity={0.6}
            />
          </Animated.View>
          <Animated.View
            className="absolute right-[-12px] top-1/2 -mt-[14px]"
            style={{ transform: [{ scaleX: -1 }] }}
          >
            <Waves
              size={28}
              color={iconColor}
              strokeWidth={1.5}
              opacity={0.6}
            />
          </Animated.View>
        </View>

        {/* Copy */}
        <Text className="text-[32px] text-center leading-[38px] font-display text-zinc-950 dark:text-zinc-50">
          Translate any voice
        </Text>
        <Text className="text-base text-center leading-[24px] font-body text-zinc-500 dark:text-zinc-400 mt-3 max-w-[300px]">
          Share a voice note — Ekwe instantly translates it into your chosen
          language. Ultra-low latency, 100+ languages.
        </Text>
      </Animated.View>

      {/* Bottom */}
      <View className="w-full items-center px-8 pb-10">
        <PageDots total={2} active={0} />
        <View className="w-full mt-6">
          <EkweButton
            variant="primary"
            size="large"
            label="Next"
            onPress={() => navigation.navigate('FeatureTwo')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
