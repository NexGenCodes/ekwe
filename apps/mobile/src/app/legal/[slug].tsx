import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import LucideChevronLeft from "lucide-react-native/icons/chevron-left";
import LucideMail from "lucide-react-native/icons/mail";
import React, { useMemo, useRef } from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { Button } from "@/components/Button";
import { Box, Text, Pressable, ScrollArea } from "@/components/ui";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_DOCUMENTS,
  type LegalSection,
} from "@/constants/legal";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";
import { withAlpha } from "@/utils/color";

type Block = { type: "paragraph" | "bullet"; text: string };

const parseBlocks = (body: string): Block[] =>
  body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.startsWith("•")
        ? { type: "bullet" as const, text: line.replace(/^•\s*/, "") }
        : { type: "paragraph" as const, text: line },
    );

interface InlineToken {
  text: string;
  bold?: boolean;
  link?: boolean;
  href?: string;
}

const parseInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last)
      tokens.push({ text: text.slice(last, match.index) });
    if (match[1]) {
      tokens.push({ text: match[1].slice(2, -2), bold: true });
    } else if (match[2]) {
      const inner = /\[([^\]]+)\]\(([^)]+)\)/.exec(match[2]);
      if (inner) tokens.push({ text: inner[1], link: true, href: inner[2] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
};

const LegalBody = ({
  text,
  baseColor,
  accentColor,
}: {
  text: string;
  baseColor: string;
  accentColor: string;
}): React.ReactElement => {
  const tokens = useMemo(() => parseInline(text), [text]);
  return (
    <Text
      variant="body"
      selectable
      style={{ color: baseColor, lineHeight: 24 }}
    >
      {tokens.map((token, index) => {
        if (token.link) {
          return (
            <Text
              key={index}
              variant="body"
              selectable
              style={{ color: accentColor, textDecorationLine: "underline" }}
              onPress={() => token.href && Linking.openURL(token.href)}
            >
              {token.text}
            </Text>
          );
        }
        return (
          <Text
            key={index}
            variant="body"
            selectable
            style={{
              color: baseColor,
              lineHeight: 24,
              fontWeight: token.bold ? "600" : "400",
            }}
          >
            {token.text}
          </Text>
        );
      })}
    </Text>
  );
};

export default function LegalScreen(): React.JSX.Element {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { color } = useTheme();

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<number[]>([]);
  const progress = useSharedValue(0);

  const doc = LEGAL_DOCUMENTS[slug || ""];

  const handleScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    progress.value =
      max > 0 ? Math.min(1, Math.max(0, contentOffset.y / max)) : 0;
  };

  const progressBarStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  const scrollToSection = (index: number): void => {
    const y = sectionY.current[index];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - spacing.md),
        animated: true,
      });
    }
  };

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
                    <LucideChevronLeft size={28} color={color.foreground} />
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
            color: color.foreground,
          },
        }}
      />

      <ScrollArea
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {}
        <Box style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              { backgroundColor: color.brand },
              progressBarStyle,
            ]}
          />
        </Box>

        <Animated.View
          entering={FadeInDown.delay(80).duration(400).springify()}
          style={{ alignItems: "center" }}
        >
          <Box
            style={[
              styles.updatedPill,
              {
                backgroundColor: withAlpha(color.brand, 0.08),
                borderColor: withAlpha(color.brand, 0.2),
              },
            ]}
          >
            <Text
              variant="caption"
              style={{ color: color.brand, fontWeight: "600" }}
            >
              Last updated {doc.lastUpdated}
            </Text>
          </Box>
        </Animated.View>

        {}
        <Animated.View
          entering={FadeInDown.delay(130).duration(400).springify()}
        >
          <Box
            style={[
              styles.tocCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Text
              variant="label"
              style={{ color: color.muted, marginBottom: spacing.sm }}
            >
              Contents
            </Text>
            {doc.sections.map((section, index) => (
              <Pressable
                key={section.title}
                feedback="scale"
                onPress={() => scrollToSection(index)}
                style={styles.tocRow}
                accessibilityRole="button"
                accessibilityLabel={`Jump to ${section.title}`}
              >
                <Text
                  variant="caption"
                  style={[styles.tocIndex, { color: color.brand }]}
                >
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: color.foreground, flex: 1 }}
                >
                  {section.title}
                </Text>
              </Pressable>
            ))}
          </Box>
        </Animated.View>

        {}
        {doc.sections.map((section, index) => (
          <LegalSectionCard
            key={section.title}
            section={section}
            index={index}
            delay={180 + index * 40}
            baseColor={color.muted}
            accentColor={color.brand}
            onLayout={(y) => {
              sectionY.current[index] = y;
            }}
          />
        ))}

        {}
        <Animated.View
          entering={FadeInDown.delay(520).duration(400).springify()}
        >
          <Box
            style={[
              styles.contactCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Text variant="heading3" style={{ color: color.foreground }}>
              Questions about this document?
            </Text>
            <Text
              variant="body"
              selectable
              style={{
                color: color.muted,
                lineHeight: 24,
                marginTop: spacing.xs,
              }}
            >
              We're happy to help. Reach our team directly at{" "}
              <Text
                variant="body"
                selectable
                style={{ color: color.brand, textDecorationLine: "underline" }}
                onPress={() => Linking.openURL(`mailto:${LEGAL_CONTACT_EMAIL}`)}
              >
                {LEGAL_CONTACT_EMAIL}
              </Text>
              .
            </Text>
            <Box style={{ marginTop: spacing.md }}>
              <Button
                variant="outline"
                size="medium"
                label="Email support"
                leftIcon={<LucideMail size={16} color={color.brand} />}
                onPress={() => Linking.openURL(`mailto:${LEGAL_CONTACT_EMAIL}`)}
              />
            </Box>
          </Box>
        </Animated.View>

        {}
        <Animated.View entering={FadeInDown.delay(580).duration(400)}>
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

const LegalSectionCard = ({
  section,
  index,
  delay,
  baseColor,
  accentColor,
  onLayout,
}: {
  section: LegalSection;
  index: number;
  delay: number;
  baseColor: string;
  accentColor: string;
  onLayout: (y: number) => void;
}): React.ReactElement => {
  const blocks = useMemo(() => parseBlocks(section.body), [section.body]);
  const { color } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400).springify()}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
    >
      <Box
        style={[
          styles.sectionCard,
          { backgroundColor: color.card, borderColor: color.border },
        ]}
      >
        <Box style={styles.sectionHeader}>
          <Text
            variant="caption"
            style={[styles.sectionIndex, { color: accentColor }]}
          >
            {String(index + 1).padStart(2, "0")}
          </Text>
          <Text
            variant="heading3"
            accessibilityRole="header"
            style={styles.sectionTitle}
          >
            {section.title}
          </Text>
        </Box>

        <Box style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {blocks.map((block, blockIndex) =>
            block.type === "bullet" ? (
              <Box key={blockIndex} style={styles.bulletRow}>
                <Box
                  style={[
                    styles.bulletDot,
                    { backgroundColor: withAlpha(accentColor, 0.7) },
                  ]}
                />
                <Box style={{ flex: 1 }}>
                  <LegalBody
                    text={block.text}
                    baseColor={baseColor}
                    accentColor={accentColor}
                  />
                </Box>
              </Box>
            ) : (
              <LegalBody
                key={blockIndex}
                text={block.text}
                baseColor={baseColor}
                accentColor={accentColor}
              />
            ),
          )}
        </Box>
      </Box>
    </Animated.View>
  );
};

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
  progressTrack: {
    height: 3,
    borderRadius: borderRadius.full,
    backgroundColor: "transparent",
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  progressFill: {
    width: "100%",
    height: "100%",
    borderRadius: borderRadius.full,
    transformOrigin: "left",
  },
  updatedPill: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  tocCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  tocRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    minHeight: 40,
    gap: spacing.md,
  },
  tocIndex: {
    fontVariant: ["tabular-nums"],
    minWidth: 24,
  },
  sectionCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sectionIndex: {
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
    marginTop: 2,
  },
  sectionTitle: {
    flex: 1,
    letterSpacing: -0.2,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: borderRadius.full,
    marginTop: 9,
  },
  contactCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
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
