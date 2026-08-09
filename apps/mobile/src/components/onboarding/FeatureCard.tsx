import React from "react";
import type { ViewStyle } from "react-native";

import { IconContainer } from "@/components/IconContainer";
import { Box, Text } from "@/components/ui";
import { iconSize } from "@/constants/sizes";
import { useTokens } from "@/hooks/ui";
import { withAlpha } from "@/utils";

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
    <Box
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
        },
        style,
      ]}
    >
      <IconContainer
        size="md"
        variant="custom"
        backgroundColor={withAlpha(color.brand, 0.12)}
        rounded="lg"
      >
        <Icon size={iconSize.md} color={color.brand} strokeWidth={2.5} />
      </IconContainer>
      <Box style={{ flex: 1 }}>
        <Text
          variant="body"
          style={{
            marginBottom: spacing.hairline,
            color: color.foreground,
          }}
        >
          {title}
        </Text>
        <Text variant="bodySmall" style={{ color: color.muted }}>
          {description}
        </Text>
      </Box>
    </Box>
  );
});
