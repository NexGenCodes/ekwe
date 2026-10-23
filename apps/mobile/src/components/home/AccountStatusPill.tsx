import { useValue } from "@legendapp/state/react";
import { useRouter } from "expo-router";
import React from "react";

import { triggerHaptic } from "@/utils/haptics";
import { pushOnce } from "@/utils/navigation";
import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { auth$ } from "@/store";

export function AccountStatusPill(): React.ReactElement {
  const { color } = useTheme();
  const router = useRouter();
  const isPro = useValue(() => auth$.isPro.get());

  if (isPro) {
    return (
      <Box
        accessible
        accessibilityRole="text"
        accessibilityLabel="Paid account"
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
          PAID
        </Text>
      </Box>
    );
  }

  return (
    <Pressable
      onPress={() => {
        triggerHaptic();
        pushOnce(router, "/billing");
      }}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Upgrade your plan. Opens billing."
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
        Upgrade
      </Text>
    </Pressable>
  );
}
