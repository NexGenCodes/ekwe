import React from "react";
import type { ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { Card, IconContainer } from "@/components";
import { Box, Text } from "@/components/ui";
import { useTheme, useTokens } from "@/hooks";
import { useStaggerEntrance } from "@/hooks/useOnboardingAnimation";

interface Feature {
  icon: React.ComponentType<{
    size?: number;
    color?: string;
    strokeWidth?: number;
  }>;
  title: string;
  description: string;
}

interface FeatureCardProps extends Feature {
  index: number;
  style?: ViewStyle;
}

export const FeatureCard = React.memo(function FeatureCard({
  icon: Icon,
  title,
  description,
  index,
  style,
}: FeatureCardProps) {
  const { color } = useTheme();
  const { spacing } = useTokens();
  const animatedStyle = useStaggerEntrance(index);

  return (
    <Animated.View style={animatedStyle}>
      <Card
        variant="default"
        padding="lg"
        style={[{ flexDirection: "row", alignItems: "center" }, style]}
      >
        <IconContainer
          size="lg"
          variant="primary"
          rounded="lg"
          style={{ marginRight: spacing.md }}
        >
          <Icon size={22} color={color.primary} strokeWidth={2.5} />
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
});
