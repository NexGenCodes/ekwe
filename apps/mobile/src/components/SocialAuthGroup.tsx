/**
 * SocialAuthGroup — Apple + Google buttons composed together.
 */
import React from "react";

import { SocialButton } from "./SocialButton";

import { Box, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

interface SocialAuthGroupProps {
  onApple: () => void;
  onGoogle: () => void;
  action?: "sign-in" | "sign-up";
  disabled?: boolean;
}

export const SocialAuthGroup = ({
  onApple,
  onGoogle,
  action = "sign-in",
  disabled = false,
}: SocialAuthGroupProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Box style={{ gap: spacing.md }}>
      <Box style={{ flexDirection: "row", gap: spacing.md }}>
        <SocialButton
          provider="apple"
          action={action}
          onPress={onApple}
          disabled={disabled}
        />
        <SocialButton
          provider="google"
          action={action}
          onPress={onGoogle}
          disabled={disabled}
        />
      </Box>
      {!isIOS ? (
        <Text
          variant="caption"
          style={{ textAlign: "center", color: color.muted }}
        >
          Sign in with Apple is only available on iPhone.
        </Text>
      ) : null}
    </Box>
  );
};
