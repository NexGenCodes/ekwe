import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ChevronRight, Globe, Mic, ShieldCheck } from "lucide-react-native";
import { useEffect, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeInDown,
} from "react-native-reanimated";

import { Button, EkweLogo, FeatureCard } from "@/components";
import { Box, ScreenContainer, Text } from "@/components/ui";
import { duration, spacing, iconSize, spinnerSize } from "@/constants";
import { useTokens } from "@/hooks/ui";
import { alpha } from "@/utils";
import { triggerHaptic } from "@/utils/haptics";

const FEATURES = [
  {
    icon: Mic,
    title: "Speak naturally",
    description: "Real-time translation as you talk. No tapping, no typing.",
  },
  {
    icon: Globe,
    title: "100+ languages",
    description: "From English to Zulu. Speak to anyone, anywhere.",
  },
  {
    icon: ShieldCheck,
    title: "Stays on your device",
    description:
      "Everything processes locally. No cloud, no copies, no worries.",
  },
];

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTokens();

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: duration.slow,
      easing: Easing.out(Easing.cubic),
    });

    router.prefetch("/language");
  }, [progress, router]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 20 }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      <LinearGradient
        colors={[
          color.background,
          alpha(color.brand, 0.1),
          color.background,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScreenContainer
        scroll
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: spacing["2xl"],
          paddingBottom: spacing["2xl"],
          paddingHorizontal: spacing.lg,
        }}
        style={{ backgroundColor: "transparent" }}
      >
        <Animated.View
          style={[
            {
              flex: 1,
              justifyContent: "space-between",
            },
            containerStyle,
          ]}
        >
          <Box>
            <Box style={{ alignItems: "center", marginBottom: spacing.xl }}>
              <Box style={{ marginBottom: spacing.md }}>
                <EkweLogo size={spacing["6xl"]} color={color.brand} />
              </Box>
              <Text
                variant="display"
                style={{
                  textAlign: "center",
                  paddingHorizontal: spacing.md,
                  color: color.foreground,
                  letterSpacing: -0.5,
                }}
              >
                Speak. We'll handle the rest.
              </Text>
              <Text
                variant="body"
                style={{
                  textAlign: "center",
                  color: color.muted,
                  marginTop: spacing.sm,
                  paddingHorizontal: spacing.md,
                }}
              >
                Real-time translation that stays on your device.
              </Text>
            </Box>

            <Box style={{ gap: spacing.md }}>
              {FEATURES.map((item, index) => (
                <Animated.View
                  key={item.title}
                  entering={FadeInDown.delay(duration.fast * 2 + index * duration.fast).springify()}
                >
                  <FeatureCard
                    icon={item.icon}
                    title={item.title}
                    description={item.description}
                  />
                </Animated.View>
              ))}
            </Box>
          </Box>

          <Box>
            <Button
              variant="primary"
              size="large"
              label="Get Started"
              onPress={useCallback(async () => {
                await triggerHaptic();
                router.replace("/language");
              }, [router])}
              rightIcon={
                <ChevronRight
                  size={iconSize.md}
                  color={color.onBrand}
                  strokeWidth={spinnerSize.strokeWidth}
                />
              }
              style={{ width: "100%" }}
            />
          </Box>
        </Animated.View>
      </ScreenContainer>
    </View>
  );
}
