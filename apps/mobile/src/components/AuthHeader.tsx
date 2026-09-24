import React from "react";

import { EkweLogo } from "@/components/EkweLogo";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface AuthHeaderProps {
  title?: string;
  subtitle: string;
  caption?: string;
}

export const AuthHeader = ({
  title,
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
        <EkweLogo size={72} color={color.brand} />
      </Box>
      {title ? (
        <Text
          variant="heading1"
          style={{
            color: color.foreground,
            textAlign: "center",
            letterSpacing: -0.3,
          }}
        >
          {title}
        </Text>
      ) : null}
      <Text
        variant="bodyLarge"
        style={{
          color: color.foreground,
          textAlign: "center",
          fontWeight: "600",
          marginTop: title ? spacing.xs : 0,
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
