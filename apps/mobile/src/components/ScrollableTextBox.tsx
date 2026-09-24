import React from "react";
import type { ViewStyle, TextStyle, StyleProp } from "react-native";

import { Card } from "@/components/Card";

import { Box, Text, Spinner, ScrollArea } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface ScrollableTextBoxProps {
  text: string | null;

  height?: number;

  variant?: "default" | "outlined" | "accent";

  brandPrimary?: string;

  isLoading?: boolean;

  containerStyle?: StyleProp<ViewStyle>;

  textStyle?: StyleProp<TextStyle>;

  header?: React.ReactNode;
}

export const ScrollableTextBox: React.FC<ScrollableTextBoxProps> = ({
  text,
  height = 280,
  variant = "default",
  brandPrimary,
  isLoading = false,
  containerStyle,
  textStyle,
  header,
}) => {
  const { color } = useTheme();
  const activeBrandPrimary = brandPrimary || color.foreground;

  return (
    <Card
      variant={variant}
      padding="none"
      style={[{ marginBottom: spacing.lg }, containerStyle]}
      overflow
    >
      {header}
      <ScrollArea
        style={{ height }}
        contentContainerStyle={{ padding: spacing.md }}
      >
        {isLoading ? (
          <Box
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              height: height - 32,
            }}
          >
            <Spinner color={activeBrandPrimary} />
            <Text
              variant="bodySmall"
              style={{ color: color.muted, marginTop: spacing.md }}
            >
              Translating...
            </Text>
          </Box>
        ) : (
          <Text variant="body" style={textStyle}>
            {text}
          </Text>
        )}
      </ScrollArea>
    </Card>
  );
};
