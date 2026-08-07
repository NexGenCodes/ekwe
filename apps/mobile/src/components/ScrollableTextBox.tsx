import React from "react";
import type { ViewStyle, TextStyle, StyleProp } from "react-native";

import { Card } from "./Card";

import { Box, Text, Spinner, ScrollArea } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface ScrollableTextBoxProps {
  /** Text content to display. */
  text: string | null;
  /** Fixed height of the scroll view container (default: 280). */
  height?: number;
  /** Card variant (default: 'default'). */
  variant?: "default" | "outlined" | "accent";
  /** Primary brand color for the loader. */
  brandPrimary?: string;
  /** Whether to show a loading indicator. */
  isLoading?: boolean;
  /** Optional extra style for the container. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Optional extra style for the text. */
  textStyle?: StyleProp<TextStyle>;
  /** Optional toolbar rendered inside the card above the scroll area. */
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
