import { Link } from "expo-router";
import React from "react";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export const Disclaimer = (): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Text
      variant="bodySmall"
      style={{
        textAlign: "center",
        color: color.muted,
        lineHeight: 24,
        marginTop: spacing["2xl"],
        marginBottom: spacing.xl,
        paddingHorizontal: spacing.md,
      }}
    >
      By continuing, you agree to our{" "}
      <Link
        href="/legal/terms"
        style={{
          color: color.brand,
          textDecorationLine: "underline",
          padding: spacing.xs,
        }}
        suppressHighlighting
      >
        Terms
      </Link>{" "}
      and{" "}
      <Link
        href="/legal/privacy"
        style={{
          color: color.brand,
          textDecorationLine: "underline",
          padding: spacing.xs,
        }}
        suppressHighlighting
      >
        Privacy Policy
      </Link>
      .
    </Text>
  );
};
