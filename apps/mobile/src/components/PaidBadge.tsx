import React from "react";
import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import Lock from "lucide-react-native/icons/lock";
import { isIOS } from "@/utils";
import { Image as ExpoImage } from "expo-image";

interface PaidBadgeProps {
  size?: "sm" | "md";
}

export const PaidBadge = ({
  size = "sm",
}: PaidBadgeProps): React.JSX.Element => {
  const { color } = useTheme();
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <Box
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: borderRadius.full,
        backgroundColor: withAlpha(color.muted, 0.1),
      }}
    >
      {isIOS ? (
        <ExpoImage
          source="sf:lock.fill"
          style={{ width: iconSize, height: iconSize }}
          tintColor={color.muted}
        />
      ) : (
        <Lock size={iconSize} color={color.muted} />
      )}
      <Text
        variant="caption"
        style={{
          color: color.muted,
          fontWeight: "600",
          fontSize: size === "sm" ? 11 : 12,
        }}
      >
        Premium
      </Text>
    </Box>
  );
};
