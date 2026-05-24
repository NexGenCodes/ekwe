import { useRouter } from 'expo-router';
import { Mic, Globe, ShieldCheck, ChevronRight } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { View, Text, Dimensions, StyleSheet } from 'react-native';
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
import { borderRadius, spacing, typography } from '@/constants/designTokens';
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
  const { color } = useTheme();
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
      style={[
        styles.featureCard,
        { backgroundColor: color.card, borderColor: color.border },
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: color.surface, borderColor: color.border },
        ]}
      >
        {icon}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: color.foreground }]}>{title}</Text>
        <Text style={[styles.description, { color: color.muted }]}>
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
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: color.background }]}
    >
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.header,
            { marginTop: SCREEN_HEIGHT * 0.08 },
            headerStyle,
          ]}
        >
          <View style={styles.logoContainer}>
            <EkweWordmark size={100} color={logoColor} />
          </View>
          <Text style={[styles.mainHeading, { color: color.foreground }]}>
            Every voice understood.
          </Text>
        </Animated.View>

        <View style={styles.featuresContainer}>
          {features.map((item, index) => (
            <FeatureCard key={item.title} {...item} index={index} />
          ))}
        </View>
      </View>

      <View style={styles.bottomSection}>
        <Button
          variant="primary"
          size="large"
          label="Get started"
          onPress={handleStart}
          rightIcon={
            <ChevronRight size={24} color={color.onPrimary} strokeWidth={3} />
          }
        />
        <Text style={[styles.disclaimer, { color: color.muted }]}>
          By continuing, you agree to our Terms and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, paddingHorizontal: spacing[6] },
  header: { alignItems: 'center', marginBottom: spacing[10] },
  logoContainer: { marginBottom: spacing[6] },
  mainHeading: {
    fontSize: 38,
    textAlign: 'center',
    lineHeight: 44,
    fontFamily: 'DMSerifDisplay-Regular',
    letterSpacing: -0.5,
    paddingHorizontal: spacing[4],
  },
  featuresContainer: { gap: spacing[5] },
  bottomSection: {
    width: '100%',
    paddingHorizontal: spacing[8],
    paddingBottom: spacing[12],
  },
  disclaimer: {
    fontSize: typography.caption.size,
    textAlign: 'center',
    marginTop: spacing[8],
    fontFamily: 'Outfit-Regular',
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[5],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[4],
    borderWidth: 1,
  },
  textContainer: { flex: 1 },
  title: {
    fontSize: typography.body.size,
    marginBottom: spacing[1] - 2,
    fontFamily: 'Outfit-Medium',
    letterSpacing: -0.5,
  },
  description: {
    fontSize: typography.bodySmall.size,
    lineHeight: typography.bodySmall.lineHeight,
    fontFamily: 'Outfit-Regular',
  },
});
