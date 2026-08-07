import AlertCircle from "lucide-react-native/icons/circle-alert";
import React from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

interface ErrorBannerProps {
  message: string | null | undefined;
}

export const ErrorBanner = ({
  message,
}: ErrorBannerProps): React.ReactElement | null => {
  const { color } = useTheme();
  return message ? (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
    >
      <Box
        style={{
          backgroundColor: withAlpha(color.error, 0.063),
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: withAlpha(color.error, 0.125),
          borderLeftWidth: 3,
          borderLeftColor: color.error,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
        }}
        accessibilityRole="alert"
      >
        <AlertCircle size={18} color={color.error} />
        <Box style={{ flex: 1 }}>
          <Text
            variant="bodySmall"
            style={{
              color: color.error,
            }}
          >
            {message}
          </Text>
        </Box>
      </Box>
    </Animated.View>
  ) : null;
};
