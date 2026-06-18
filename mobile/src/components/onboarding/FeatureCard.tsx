import React from "react";
import type { ViewStyle } from "react-native";

import { Card } from "@/components/Card";
import { IconContainer } from "@/components/IconContainer";
import { Box, Text } from "@/components/ui";
import { iconSize } from "@/constants/sizes";
import { useTokens } from "@/hooks/ui";

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
  style?: ViewStyle;
}

export const FeatureCard = React.memo(function FeatureCard({
  icon: Icon,
  title,
  description,
  style,
}: FeatureCardProps) {
  const { color, spacing } = useTokens();

  return (
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
        <Icon size={iconSize.md} color={color.primary} strokeWidth={2.5} />
      </IconContainer>
      <Box style={{ flex: 1 }}>
        <Text
          variant="body"
          style={{
            marginBottom: spacing.xs - 2,
            color: color.foreground,
          }}
        >
          {title}
        </Text>
        <Text variant="bodySmall" style={{ color: color.muted }}>
          {description}
        </Text>
      </Box>
    </Card>
  );
});
