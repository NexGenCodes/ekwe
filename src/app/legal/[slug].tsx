import { useLocalSearchParams, Stack } from 'expo-router';
import React from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Box, Text, ScrollArea } from '@/components/ui';
import { LEGAL_DOCUMENTS } from '@/constants/legal';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useTheme } from '@/hooks';

export default function LegalScreen(): React.JSX.Element {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { color } = useTheme();

  const doc = LEGAL_DOCUMENTS[slug || ''];

  const Container = Box;
  const containerProps = {
    style: { flex: 1, backgroundColor: color.background },
  };

  if (!doc) {
    return (
      <Container {...containerProps} style={styles.flex1}>
        <Box style={styles.emptyState}>
          <Text
            variant="body"
            style={[styles.emptyText, { color: color.muted }]}
          >
            Document not found.
          </Text>
        </Box>
      </Container>
    );
  }

  return (
    <Container {...containerProps} style={styles.flex1}>
      <Stack.Screen
        options={{
          title: doc.title,
          headerShown: true,
          headerTransparent: false,
          headerStyle: {
            backgroundColor: color.background,
          },
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: typography.heading2.fontFamily,
            fontSize: 24,
            fontWeight: '400',
            color: color.foreground,
          },
          headerTintColor: color.primary,
        }}
      />

      <ScrollArea
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <Text
            variant="bodySmall"
            style={[styles.lastUpdated, { color: color.muted }]}
          >
            Last updated: {doc.lastUpdated}
          </Text>
        </Animated.View>

        {doc.sections.map((section, index) => (
          <Animated.View
            key={section.title}
            entering={FadeInDown.delay(150 + index * 50).duration(400)}
            style={[
              styles.sectionCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Text variant="body" style={styles.sectionTitle}>
              {section.title}
            </Text>
            <Text
              variant="body"
              style={[styles.sectionBody, { color: color.muted }]}
            >
              {section.body}
            </Text>
          </Animated.View>
        ))}

        {/* Footer */}
        <Box style={styles.footer}>
          <Text
            variant="caption"
            style={[styles.footerText, { color: color.muted }]}
          >
            © {new Date().getFullYear()} Ekwe. All rights reserved.
          </Text>
        </Box>
      </ScrollArea>
    </Container>
  );
}

const styles = {
  flex1: {
    flex: 1,
  } as const,
  scrollView: {
    flex: 1,
  } as const,
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
    paddingTop: spacing.md,
  } as const,
  lastUpdated: {
    marginBottom: spacing.lg,
    textAlign: 'center',
  } as const,
  sectionCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  } as const,
  sectionTitle: {
    marginBottom: spacing.sm,
  } as const,
  sectionBody: {} as const,
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  } as const,
  footerText: {} as const,
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  emptyText: {} as const,
};
