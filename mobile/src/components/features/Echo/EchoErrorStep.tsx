import { AlertCircle, RefreshCw } from "lucide-react-native";
import React from "react";

import { Button } from "../../Button";

import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import type { ThemeTokens } from "@/hooks/ui";
import type { EchoStep } from "@/types/echo";

interface EchoErrorStepProps {
  error: string | null;
  color: ThemeTokens["color"];
  onRetry: (step: EchoStep) => void;
}

export const EchoErrorStep = React.memo(function EchoErrorStep({
  error,
  color,
  onRetry,
}: EchoErrorStepProps) {
  return (
    <Box
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing.xl,
      }}
    >
      <Box
        style={{
          width: 64,
          height: 64,
          borderRadius: borderRadius["2xl"],
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.lg,
          backgroundColor: `${color.error}15`,
        }}
      >
        <AlertCircle size={32} color={color.error} />
      </Box>
      <Text
        variant="body"
        style={{
          textAlign: "center",
          marginBottom: spacing.sm,
          paddingHorizontal: spacing.lg,
          color: color.foreground,
        }}
      >
        {error || "An unexpected error occurred"}
      </Text>
      <Text
        variant="bodySmall"
        style={{
          textAlign: "center",
          marginBottom: spacing.lg,
          color: color.muted,
        }}
      >
        Please check your connection and try again.
      </Text>
      <Button
        variant="primary"
        leftIcon={<RefreshCw size={16} color={color.onBrand} />}
        label="Start Over"
        onPress={() => onRetry("PickLanguage")}
      />
    </Box>
  );
});
