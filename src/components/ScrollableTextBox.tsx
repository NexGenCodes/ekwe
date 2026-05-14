import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
  ScrollView,
} from 'react-native';

import { Card } from './ui/Card';

import { useTheme } from '@/hooks';

interface ScrollableTextBoxProps {
  /** Text content to display. */
  text: string | null;
  /** Fixed height of the scroll view container (default: 280). */
  height?: number;
  /** Card variant (default: 'default'). */
  variant?: 'default' | 'outlined' | 'accent';
  /** Primary brand color for the loader. */
  brandPrimary?: string;
  /** Whether to show a loading indicator. */
  isLoading?: boolean;
  /** Optional extra style for the container. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Optional extra style for the text. */
  textStyle?: StyleProp<TextStyle>;
}

export const ScrollableTextBox: React.FC<ScrollableTextBoxProps> = ({
  text,
  height = 280,
  variant = 'default',
  brandPrimary,
  isLoading = false,
  containerStyle,
  textStyle,
}) => {
  const { color } = useTheme();
  const activeBrandPrimary = brandPrimary || color.primary;
  const activeTextColor = color.foreground;

  return (
    <Card
      variant={variant}
      padding="none"
      style={[styles.cardOverride, containerStyle]}
      overflow
    >
      <ScrollView
        style={{ height }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={[styles.loadingBox, { height: height - 32 }]}>
            <ActivityIndicator color={activeBrandPrimary} />
            <Text style={[styles.loadingTxt, { color: color.muted }]}>
              Translating...
            </Text>
          </View>
        ) : (
          <Text style={[styles.text, { color: activeTextColor }, textStyle]}>
            {text}
          </Text>
        )}
      </ScrollView>
    </Card>
  );
};

const styles = StyleSheet.create({
  cardOverride: {
    marginBottom: 24,
  },
  scrollContent: {
    padding: 16,
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    fontFamily: 'Outfit-Regular',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTxt: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Outfit-Regular',
  },
});
