import React from "react";

import { IconContainer } from "@/components/IconContainer";

import { EkweLogo } from "@/components/EkweLogo";
import { AccountStatusPill } from "@/components/home/AccountStatusPill";
import { Box, Text } from "@/components/ui";
import { iconSize } from "@/constants";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

export const HomeHeader = React.memo(function HomeHeader(): React.ReactElement {
  const { color } = useTheme();

  return (
    <Box
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: spacing.md,
      }}
    >
      <Box
        accessible
        accessibilityRole="header"
        accessibilityLabel="Ekwe"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <IconContainer
          size="xl"
          variant="custom"
          backgroundColor={withAlpha(color.brand, 0.082)}
        >
          <EkweLogo size={iconSize.xl} color={color.brand} />
        </IconContainer>
        <Text variant="display">Ekwe</Text>
      </Box>

      <AccountStatusPill />
    </Box>
  );
});
