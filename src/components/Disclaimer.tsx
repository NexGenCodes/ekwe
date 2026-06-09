import { Link } from "expo-router";
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export const Disclaimer: React.FC = () => {
  const { color } = useTheme();
  return (
    <Animated.View entering={FadeIn.delay(800).duration(1000)}>
      <Text
        variant="bodySmall"
        style={{
          textAlign: "center",
          color: color.muted,
          marginTop: spacing["2xl"],
          marginBottom: spacing.xl,
          paddingHorizontal: spacing.md,
          lineHeight: 24, // Increased line height gives the links a taller hit box
        }}
      >
        By continuing, you agree to our{" "}
        <Link
          href="/legal/terms"
          style={{
            color: color.secondary,
            textDecorationLine: "underline",
            padding: spacing.xs, // Increases touch target slightly
          }}
          suppressHighlighting
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          href="/legal/privacy"
          style={{
            color: color.secondary,
            textDecorationLine: "underline",
            padding: spacing.xs, // Increases touch target slightly
          }}
          suppressHighlighting
        >
          Privacy Policy
        </Link>
        .
      </Text>
    </Animated.View>
  );
};

export default Disclaimer;
