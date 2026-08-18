import { useRouter } from "expo-router";
import React from "react";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { pushOnce } from "@/utils/navigation";

export const Disclaimer = (): React.ReactElement => {
  const router = useRouter();
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
      <Text
        accessibilityRole="link"
        style={{
          color: color.brand,
          textDecorationLine: "underline",
          paddingVertical: 6,
          paddingHorizontal: 4,
          marginVertical: -6,
          marginHorizontal: -4,
        }}
        onPress={() => pushOnce(router, "/legal/terms")}
      >
        Terms
      </Text>{" "}
      and{" "}
      <Text
        accessibilityRole="link"
        style={{
          color: color.brand,
          textDecorationLine: "underline",
          paddingVertical: 6,
          paddingHorizontal: 4,
          marginVertical: -6,
          marginHorizontal: -4,
        }}
        onPress={() => pushOnce(router, "/legal/privacy")}
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
};
