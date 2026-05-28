import { useRouter, Link } from "expo-router";
import { Mic, Globe, ShieldCheck, ChevronRight } from "lucide-react-native";
import React, { useEffect, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
} from "react-native-reanimated";

import { Button, EkweLogo, Card, IconContainer } from "@/components";
import { Box, Text, ScrollArea } from "@/components/ui";
import { useTheme, useTokens } from "@/hooks";

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
  const tokens = useTokens();
  const { spacing } = tokens;

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
    <Animated.View style={animatedStyle}>
      <Card
        variant="default"
        padding="lg"
        style={{
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <IconContainer
          size="lg"
          variant="primary"
          rounded="lg"
          style={{ marginRight: spacing.md }}
        >
          {icon}
        </IconContainer>
        <Box style={{ flex: 1 }}>
          <Text
            variant="body"
            style={{ marginBottom: spacing.xs - 2, color: color.foreground }}
          >
            {title}
          </Text>
          <Text variant="bodySmall" style={{ color: color.muted }}>
            {description}
          </Text>
        </Box>
      </Card>
    </Animated.View>
  );
};

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const tokens = useTokens();
  const { spacing } = tokens;

  const styles = useMemo(
    () => ({
      containerContent: {
        paddingTop: spacing['2xl'],
        paddingBottom: spacing['6xl'],
        justifyContent: "space-between",
      } as const,
      header: { alignItems: "center", marginBottom: spacing.xl } as const,
      mainHeading: {
        textAlign: "center",
        paddingHorizontal: spacing.md,
      } as const,
      featuresContainer: { gap: spacing.lg } as const,
      bottomSection: {
        width: "100%",
        paddingBottom: spacing.xl,
        marginTop: spacing.xl,
      } as const,
      disclaimer: {
        textAlign: "center",
        marginTop: spacing.xl,
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "nowrap",
        overflow: "hidden",
      } as const,
    }),
    [spacing],
  );

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
        title: "Speak Freely",
        description: "Your words, translated as you speak.",
      },
      {
        icon: <Globe size={22} color={iconColor} strokeWidth={2.5} />,
        title: "Any Language",
        description: "Speak to anyone, anywhere — 100+ languages.",
      },
      {
        icon: <ShieldCheck size={22} color={iconColor} strokeWidth={2.5} />,
        title: "Private by Design",
        description: "Everything stays on your device. No cloud, no copies.",
      },
    ],
    [iconColor],
  );

  const handleStart = (): void => {
    // Navigate to Language Selection; onboarding is NOT complete until Auth is finalized
    router.replace("/language");
  };

  const { height: SCREEN_HEIGHT } = useWindowDimensions();

  return (
    <Box style={{ flex: 1, backgroundColor: color.background }}>
      <ScrollArea
        style={{ flex: 1 }}
        contentContainerStyle={styles.containerContent}
      >
        <Box>
          <Animated.View
            style={[
              styles.header,
              { marginTop: SCREEN_HEIGHT * 0.04 },
              headerStyle,
            ]}
          >
            <Box style={{ marginBottom: spacing.md }}>
              <EkweLogo size={80} color={color.secondary} />
            </Box>
            <Text variant="display" style={styles.mainHeading}>
              Every voice understood.
            </Text>
          </Animated.View>

          <Box style={styles.featuresContainer}>
            {features.map((item, index) => (
              <FeatureCard key={item.title} {...item} index={index} />
            ))}
          </Box>
        </Box>

        <Box style={styles.bottomSection}>
          <Button
            variant="primary"
            size="large"
            label="Get started"
            onPress={handleStart}
            rightIcon={
              <ChevronRight
                size={24}
                color={color.onSecondary}
                strokeWidth={3}
              />
            }
          />
        </Box>
      </ScrollArea>
    </Box>
  );
}
