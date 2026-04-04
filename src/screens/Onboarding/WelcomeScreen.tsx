import { Mic, Globe, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { View, Text, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { EkweButton } from 'src/components/common/EkweButton';
import { getColor } from 'src/constants/theme';
import { RootScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

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
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(
      400 + index * 150,
      withTiming(1, { duration: 600 }),
    );
    translateY.value = withDelay(
      400 + index * 150,
      withSpring(0, { damping: 15, stiffness: 100 }),
    );
  }, [index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      className="flex-row items-center p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-card dark:bg-card-dark shadow-sm"
      style={animatedStyle}
    >
      <View className="w-12 h-12 rounded-2xl items-center justify-center mr-4 bg-background dark:bg-background-dark border border-zinc-100 dark:border-zinc-800">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-base mb-0.5 font-bodyMed text-zinc-950 dark:text-zinc-50">
          {title}
        </Text>
        <Text className="text-sm leading-5 font-body text-zinc-500 dark:text-zinc-400">
          {description}
        </Text>
      </View>
    </Animated.View>
  );
};

export const WelcomeScreen = ({
  navigation,
}: RootScreenProps<'Welcome'>): React.ReactElement => {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const { colorScheme } = useColorScheme();

  const isDark = colorScheme === 'dark';
  const iconColor = getColor('primaryAccent', isDark);
  const logoColor = getColor('foreground', isDark);

  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(-20);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 800 });
    headerTranslateY.value = withSpring(0, { damping: 12 });
  }, [headerOpacity, headerTranslateY]);

  const features = [
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
  ];

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-1 px-6">
        <Animated.View
          className="items-center mb-12"
          style={[{ marginTop: SCREEN_HEIGHT * 0.08 }, headerStyle]}
        >
          <View className="mb-4">
            <EkweWordmark size={90} color={logoColor} />
          </View>
          <Text className="text-[32px] text-center leading-[38px] font-display text-zinc-950 dark:text-zinc-50">
            Every voice understood.
          </Text>
        </Animated.View>

        <View className="gap-4">
          {features.map((item, index) => (
            <FeatureCard key={item.title} {...item} index={index} />
          ))}
        </View>
      </View>

      <View className="w-full px-8 pb-10">
        <EkweButton
          variant="primary"
          size="large"
          label="Get started"
          onPress={() => {
            if (onboardingCompleted) {
              navigation.replace('Main', {
                screen: 'MainTabs',
                params: { screen: 'Home' },
              });
            } else {
              navigation.navigate('Onboarding', {
                screen: 'FeatureOne',
              });
            }
          }}
          rightIcon={
            <ChevronRight
              size={20}
              color={getColor('onPrimary', isDark)}
              strokeWidth={2.5}
            />
          }
        />
        <Text className="text-xs text-center mt-6 font-body text-zinc-500 dark:text-zinc-400">
          By continuing, you agree to our Terms and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
};
