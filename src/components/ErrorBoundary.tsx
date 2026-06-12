import * as Sentry from "@sentry/react-native";
import { AlertCircle, RotateCcw } from "lucide-react-native";
import React, { Component, ErrorInfo, ReactNode } from "react";
import { Appearance } from "react-native";

import { Button } from "./Button";

import { Box, Text, SafeArea } from "@/components/ui";
import { getTheme } from "@/constants/colors";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import logger from "@/utils/logger";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error("ErrorBoundary caught:", error, errorInfo.componentStack);
    Sentry.withScope((scope) => {
      scope.setExtra("componentStack", errorInfo.componentStack);
      scope.setTag("handled_by", "ErrorBoundary");
      Sentry.captureException(error);
    });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    const colorScheme = Appearance.getColorScheme();
    const isDark = colorScheme === "dark";
    const color = getTheme(isDark);

    if (this.state.hasError) {
      return (
        <SafeArea
          style={{
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.xl,
          }}
        >
          <Box style={{ alignItems: "center", marginBottom: spacing.xl }}>
            <Box
              style={[
                {
                  width: 80,
                  height: 80,
                  borderRadius: borderRadius["2xl"],
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: spacing.lg,
                },
                { backgroundColor: `${color.error}18` },
              ]}
            >
              <AlertCircle size={40} color={color.error} strokeWidth={2} />
            </Box>
            <Text
              variant="heading2"
              style={{
                textAlign: "center",
                marginBottom: spacing.md,
              }}
            >
              Something went wrong
            </Text>
            <Text
              variant="body"
              style={{
                color: color.muted,
                textAlign: "center",
              }}
            >
              An unexpected error occurred. Our team has been notified.
            </Text>
          </Box>

          <Box style={{ width: "100%", gap: spacing.md }}>
            <Button
              label="Try again"
              variant="primary"
              onPress={this.handleReset}
              leftIcon={<RotateCcw size={20} color={color.onPrimary} />}
            />
          </Box>

          {__DEV__ && (
            <Box
              style={{
                marginTop: spacing["3xl"],
                padding: spacing.md,
                borderRadius: borderRadius.lg,
                backgroundColor: color.surface,
                width: "100%",
              }}
            >
              <Text variant="caption" style={{ color: color.muted }}>
                {this.state.error?.toString()}
              </Text>
            </Box>
          )}
        </SafeArea>
      );
    }

    return this.props.children;
  }
}
