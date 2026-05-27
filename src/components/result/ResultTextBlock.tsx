import { Copy, Check } from 'lucide-react-native';
import React from 'react';
import { StyleSheet } from 'react-native';

import { Card } from '@/components/Card';
import { Box, Pressable, Text } from '@/components/ui';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme, useClipboard } from '@/hooks';

export interface ResultTextBlockProps {
  title: string;
  text: string;
  variant?: 'default' | 'accent';
}

export function ResultTextBlock({
  title,
  text,
  variant = 'default',
}: ResultTextBlockProps): React.JSX.Element {
  const { color } = useTheme();
  const primaryColor = color.primary;
  const { copied, copy } = useClipboard();

  const handleCopy = (): void => {
    copy(text);
  };

  return (
    <Box style={styles.block}>
      <Box style={styles.blockHeader}>
        <Text
          variant="caption"
          style={{
            textTransform: 'uppercase',
            color: variant === 'accent' ? primaryColor : color.muted,
          }}
        >
          {title}
        </Text>
        <Box style={styles.headerActions}>
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: color.secondary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            hitSlop={spacing.sm}
          >
            {copied ? (
              <Check size={16} color={color.onSecondary} strokeWidth={2.5} />
            ) : (
              <Copy size={16} color={color.onSecondary} strokeWidth={2.5} />
            )}
          </Pressable>
        </Box>
      </Box>
      <Card
        variant={variant}
        style={{
          padding: spacing.lg,
          borderRadius: borderRadius['2xl'],
        }}
      >
        <Text variant="bodyLarge" style={{ color: color.foreground }}>
          {text}
        </Text>
      </Card>
    </Box>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.xl,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
