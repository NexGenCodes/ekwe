/**
 * SocialAuthGroup — Apple + Google buttons composed together.
 */
import React from "react";

import { SocialButton } from "./SocialButton";

import { Box } from "@/components/ui";
import { spacing } from "@/constants/spacing";

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
}: SocialAuthGroupProps): React.ReactElement => (
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
);
