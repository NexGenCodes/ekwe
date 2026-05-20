import { AlertCircle, RotateCcw } from 'lucide-react-native';
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from './Button';

import { colors } from '@/constants/colors';
import logger from '@/utils/logger';

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
    logger.error('ErrorBoundary caught:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <AlertCircle
                size={40}
                color={colors.error.DEFAULT}
                strokeWidth={2}
              />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              An unexpected error occurred. Our team has been notified.
            </Text>
          </View>

          <View style={styles.buttonContainer}>
            <Button
              label="Try again"
              variant="primary"
              onPress={this.handleReset}
              leftIcon={<RotateCcw size={20} color="white" />}
            />
          </View>

          {__DEV__ && (
            <View style={styles.devErrorContainer}>
              <Text style={styles.devErrorText}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: { alignItems: 'center', marginBottom: 32 },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(254, 226, 226, 1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Outfit-Medium',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Outfit-Regular',
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonContainer: { width: '100%', gap: 16 },
  devErrorContainer: {
    marginTop: 48,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f4f4f5',
    width: '100%',
  },
  devErrorText: { fontSize: 12, color: '#71717a' },
});
