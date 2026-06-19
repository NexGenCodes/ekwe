import { useSelector } from "@legendapp/state/react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { auth$ } from "@/store";

export function AccountStatusPill(): React.ReactElement {
  const { color } = useTheme();
  const router = useRouter();
  const isPro = useSelector(() => auth$.isPro.get());

  if (isPro) {
    return (
      <Box
        accessible
        accessibilityRole="text"
        accessibilityLabel="Pro account"
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: borderRadius.full,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          minWidth: 80,
          borderColor: color.warning,
          backgroundColor: color.card,
        }}
      >
        <Text
          variant="bodySmall"
          style={{
            color: color.foreground,
            textTransform: "uppercase",
          }}
        >
          PRO
        </Text>
      </Box>
    );
  }

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push("/billing");
      }}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Upgrade to Pro. Opens billing."
      style={({ pressed }) => [
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: borderRadius.full,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          minWidth: 80,
          backgroundColor: color.brand,
          borderColor: color.brand,
        },
        pressed && {
          opacity: 0.8,
          transform: [{ scale: 0.96 }],
        },
      ]}
    >
      <Text
        variant="bodySmall"
        style={{
          color: color.onBrand,
        }}
      >
        Go Pro
      </Text>
    </Pressable>
  );
}
