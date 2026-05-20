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
      style={[
        styles.featureCard,
        { backgroundColor: '#FFFFFF', borderColor: '#E4E4E7' }, // Since useTheme is not passed here, fallback to hardcoded or wait for refactoring if needed, but we can access color.card if we passed it. Let's pass color to FeatureCard to make it proper.
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: '#F4F4F5', borderColor: '#F4F4F5' },
        ]}
      >
        {icon}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: '#09090b' }]}>{title}</Text>
        <Text style={[styles.description, { color: '#71717A' }]}>
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
  container: { flex: 1, paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logoContainer: { marginBottom: 24 },
  mainHeading: {
    fontSize: 34,
    textAlign: 'center',
    lineHeight: 40,
    fontFamily: 'Outfit-Medium',
    letterSpacing: -0.5,
    paddingHorizontal: 16,
  },
  featuresContainer: { gap: 20 },
  bottomSection: { width: '100%', paddingHorizontal: 32, paddingBottom: 48 },
  disclaimer: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
    fontFamily: 'Outfit-Regular',
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    borderWidth: 1,
  },
  textContainer: { flex: 1 },
  title: {
    fontSize: 16,
    marginBottom: 2,
    fontFamily: 'Outfit-Medium',
    letterSpacing: -0.5,
  },
  description: { fontSize: 14, lineHeight: 20, fontFamily: 'Outfit-Regular' },
});
