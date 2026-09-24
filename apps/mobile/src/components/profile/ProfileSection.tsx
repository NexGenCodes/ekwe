import React from "react";
import Animated, { LinearTransition } from "react-native-reanimated";

import { Box, Text } from "@/components/ui";
import { spring } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

export interface ProfileSectionProps {
  title: string;
  titleColor?: string;
  children: React.ReactNode;

  tierBar?: "pro" | "free";
}

export function ProfileSection({
  title,
  titleColor,
  children,
  tierBar,
}: ProfileSectionProps): React.JSX.Element {
  const { color } = useTheme();

  const barColor =
    tierBar === "pro" ? color.brand : withAlpha(color.foreground, 0.32);
  const borderColor =
    tierBar === "pro"
      ? withAlpha(color.brand, 0.35)
      : withAlpha(color.foreground, 0.14);

  return (
    <Box style={{ marginBottom: spacing.xl }}>
      <Text
        variant="caption"
        style={{
          textTransform: "uppercase",
          marginBottom: spacing.md,
          color: titleColor ?? color.muted,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </Text>
      <Animated.View
        layout={LinearTransition.springify()
          .damping(spring.smooth.damping)
          .stiffness(spring.smooth.stiffness)
          .mass(spring.smooth.mass)}
        style={{
          borderRadius: borderRadius["2xl"],
          borderWidth: 1,
          overflow: "hidden",
          backgroundColor: color.card,
          borderColor,
        }}
      >
        {tierBar && (
          <Box
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                backgroundColor: barColor,
              },
            ]}
          />
        )}
        {children}
      </Animated.View>
    </Box>
  );
}
