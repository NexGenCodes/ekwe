import React from "react";

import { EkweLogo } from "./EkweLogo";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface AuthHeaderProps {
  subtitle: string;
  caption?: string;
}

export const AuthHeader = ({
  subtitle,
  caption,
}: AuthHeaderProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Box style={{ alignItems: "center", marginBottom: spacing.xl }}>
      <Box
        style={{
          marginBottom: spacing.md,
          opacity: 0.9,
        }}
      >
        <EkweLogo size={56} color={color.secondary} />
      </Box>
      <Text
        variant="bodyLarge"
        style={{
          color: color.foreground,
          textAlign: "center",
          fontWeight: "600",
        }}
      >
        {subtitle}
      </Text>
      {caption ? (
        <Text
          variant="bodySmall"
          style={{
            color: color.muted,
            marginTop: spacing.xs,
            textAlign: "center",
            paddingHorizontal: spacing.md,
          }}
        >
          {caption}
        </Text>
      ) : null}
    </Box>
  );
};
