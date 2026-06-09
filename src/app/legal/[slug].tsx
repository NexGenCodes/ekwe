import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { LucideChevronLeft } from "lucide-react-native";
import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button } from "@/components/Button";
import { Box, Text, ScrollArea } from "@/components/ui";
import { LEGAL_DOCUMENTS } from "@/constants/legal";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

export default function LegalScreen(): React.JSX.Element {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { color } = useTheme();

  const doc = LEGAL_DOCUMENTS[slug || ""];

  if (!doc) {
    return (
      <Box style={[styles.flex1, { backgroundColor: color.background }]}>
        <Box style={styles.emptyState}>
          <Text
            variant="body"
            style={[styles.emptyText, { color: color.muted }]}
          >
            Document not found.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <Stack.Screen
        options={{
          title: doc.title,
          headerShown: true,
          headerTransparent: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: color.background },
          headerLeft: () => (
            <Box
              style={{
                marginLeft: isIOS ? 0 : spacing.sm,
                marginRight: spacing.lg,
              }}
            >
              <Button
                variant="ghost"
                size="small"
                onPress={() => router.back()}
                leftIcon={
                  <Box style={{ marginRight: -spacing.sm }}>
                    <LucideChevronLeft size={28} color={color.primary} />
                  </Box>
                }
                label=""
              />
            </Box>
          ),
          headerTitleStyle: {
            fontFamily: typography.heading2.fontFamily,
            fontSize: 24,
            fontWeight: "400",
            letterSpacing: -0.5,
            color: color.foreground,
          },
        }}
      />

      <ScrollArea
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View entering={FadeInDown.delay(100).duration(400).springify()}>
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
            entering={FadeInDown.delay(150 + index * 50).duration(400).springify()}
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
              style={[styles.sectionBody, { color: color.muted, lineHeight: 24 }]}
            >
              {section.body}
            </Text>
          </Animated.View>
        ))}

        {/* Footer */}
        <Animated.View entering={FadeInDown.delay(500).duration(400)}>
          <Box style={styles.footer}>
            <Text
              variant="caption"
              style={[styles.footerText, { color: color.muted }]}
            >
              © {new Date().getFullYear()} Ekwe. All rights reserved.
            </Text>
          </Box>
        </Animated.View>
      </ScrollArea>
    </Box>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing["3xl"],
    paddingTop: spacing.md,
  },
  lastUpdated: {
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  sectionCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
  },
  sectionBody: {},
  footer: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  footerText: {},
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {},
});
