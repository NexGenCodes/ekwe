import React from "react";
import { Text, View } from "react-native";
import logger from "@/utils/logger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 8 }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 13, color: "#666", textAlign: "center" }}>
            {this.state.error?.message}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}
