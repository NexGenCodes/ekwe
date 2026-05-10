import { useRouter } from 'expo-router';
import { Mic, Globe, ShieldCheck, ChevronRight } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { View, Text, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweWordmark } from '@/assets/icons/EkweWordmark';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FeatureItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  index: number;
}

const FeatureCard = ({
  icon,
  title,
  description,
  index,
}: FeatureItemProps): React.ReactElement => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(30);
  const scale = useSharedValue(0.95);

  useEffect(() => {
    const delay = 600 + index * 180;

    opacity.value = withDelay(delay, withTiming(1, { duration: 700 }));
    translateY.value = withDelay(
      delay,
      withSpring(0, {
        damping: 15,
        stiffness: 90,
        mass: 0.8,
      }),
    );
    scale.value = withDelay(
      delay,
      withSpring(1, {
        damping: 15,
        stiffness: 100,
      }),
    );
  }, [index, opacity, translateY, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      className="flex-row items-center p-5 rounded-[24px] border border-border dark:border-zinc-800/80 bg-card dark:bg-card-dark shadow-sm"
      style={animatedStyle}
    >
      <View className="w-12 h-12 rounded-2xl items-center justify-center mr-4 bg-background dark:bg-background-dark border border-zinc-100 dark:border-zinc-800">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-base mb-0.5 font-bodyMed text-foreground dark:text-zinc-50 tracking-tight">
          {title}
        </Text>
        <Text className="text-sm leading-5 font-body text-muted dark:text-zinc-400">
          {description}
        </Text>
      </View>
    </Animated.View>
  );
};

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const iconColor = color.primary;
  const logoColor = color.foreground;

  const headerOpacity = useSharedValue(0);
  const headerScale = useSharedValue(0.9);
  const headerTranslateY = useSharedValue(-20);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [
      { translateY: headerTranslateY.value },
      { scale: headerScale.value },
    ],
  }));

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 1000 });
    headerScale.value = withSpring(1, { damping: 15, stiffness: 60 });
    headerTranslateY.value = withSpring(0, { damping: 15, stiffness: 60 });
  }, [headerOpacity, headerScale, headerTranslateY]);

  const features = useMemo(
    () => [
      {
        icon: <Mic size={22} color={iconColor} strokeWidth={2.5} />,
        title: 'Neural Capture',
        description: 'Ultra-low latency voice note translation.',
      },
      {
        icon: <Globe size={22} color={iconColor} strokeWidth={2.5} />,
        title: 'Global Bridge',
        description: 'Support for 100+ languages across all apps.',
      },
      {
        icon: <ShieldCheck size={22} color={iconColor} strokeWidth={2.5} />,
        title: 'Obsidian Security',
        description: 'On-device processing for absolute privacy.',
      },
    ],
    [iconColor],
  );

  const handleStart = (): void => {
    // Navigate to Language Selection; onboarding is NOT complete until Auth is finalized
    router.replace('/language');
  };

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-1 px-6">
        <Animated.View
          className="items-center mb-10"
          style={[{ marginTop: SCREEN_HEIGHT * 0.08 }, headerStyle]}
        >
          <View className="mb-6">
            <EkweWordmark size={100} color={logoColor} />
          </View>
          <Text className="text-[34px] text-center leading-[40px] font-display text-foreground dark:text-foreground-dark tracking-tight px-4">
            Every voice understood.
          </Text>
        </Animated.View>

        <View className="gap-5">
          {features.map((item, index) => (
            <FeatureCard key={item.title} {...item} index={index} />
          ))}
        </View>
      </View>

      <View className="w-full px-8 pb-12">
        <Button
          variant="primary"
          size="large"
          label="Get started"
          onPress={handleStart}
          rightIcon={
            <ChevronRight
              size={24}
              color={color.onPrimary}
              strokeWidth={3}
            />
          }
        />
        <Text className="text-xs text-center mt-8 font-body text-muted dark:text-zinc-600">
          By continuing, you agree to our Terms and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}
