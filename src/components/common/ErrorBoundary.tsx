import { AlertCircle, RotateCcw } from 'lucide-react-native';
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweButton } from '@/components/common/EkweButton';
import { getColor } from '@/constants/colors';

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
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <SafeAreaView className="flex-1 bg-background dark:bg-background-dark items-center justify-center px-8">
          <View className="items-center mb-8">
            <View className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-950/30 items-center justify-center mb-6">
              <AlertCircle
                size={40}
                color={getColor('error', true)}
                strokeWidth={2}
              />
            </View>
            <Text className="text-2xl font-display text-foreground dark:text-foreground-dark text-center mb-3">
              Something went wrong
            </Text>
            <Text className="text-base font-body text-muted dark:text-muted-dark text-center leading-6">
              An unexpected error occurred. Our team has been notified.
            </Text>
          </View>

          <View className="w-full gap-4">
            <EkweButton
              label="Try again"
              variant="primary"
              onPress={this.handleReset}
              leftIcon={<RotateCcw size={20} color="white" />}
            />
          </View>

          {__DEV__ && (
            <View className="mt-12 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-900 w-full">
              <Text className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                {this.state.error?.toString()}
              </Text>
            </View>
          )}
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}
