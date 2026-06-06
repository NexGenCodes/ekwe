import { Image as ExpoImage } from "expo-image";
import {
  LucideShieldCheck,
  LucideBatteryCharging,
  LucideZap,
} from "lucide-react-native";
import React from "react";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Box, Text, Pressable, ScrollArea } from "@/components/ui";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

export interface AccessibilityDisclosureProps {
  onAgree: () => void;
  onDeny: () => void;
}

export const AccessibilityDisclosure: React.FC<
  AccessibilityDisclosureProps
> = ({ onAgree, onDeny }) => {
  const { color } = useTheme();
  const primaryColor = color.primary;

  return (
    <Box style={{ flex: 1, backgroundColor: color.background }}>
      <ScrollArea
        style={{ flex: 1, paddingHorizontal: spacing.lg }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View
          entering={FadeInDown.duration(500).springify()}
          style={{ marginTop: spacing.xl, marginBottom: spacing.xl }}
        >
          <Text variant="display">Accessibility Service Disclosure</Text>
          <Box
            style={{
              marginTop: spacing.md,
              padding: spacing.md,
              borderRadius: borderRadius.xl,
              borderWidth: 1,
              backgroundColor: `${primaryColor}1A`,
              borderColor: `${primaryColor}33`,
            }}
          >
            <Text
              variant="bodySmall"
              style={{ marginBottom: spacing.xs, color: primaryColor }}
            >
              Google Play Policy Requirement
            </Text>
            <Text variant="bodySmall">
              This app uses the{" "}
              <Text variant="bodySmall">AccessibilityService API</Text> to
              detect when you open messaging applications (like WhatsApp or
              Tinder). This allows Ekwe to automatically display the floating
              translation tool over your screen exactly when you need it.
            </Text>
          </Box>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(500).delay(100).springify()}
          style={{ gap: spacing.lg, marginBottom: 160 }}
        >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <Box
              style={{
                padding: spacing.md,
                borderRadius: borderRadius.xl,
                backgroundColor: `${primaryColor}1A`,
              }}
            >
              {isIOS ? (
                <ExpoImage
                  source="sf:bolt.fill"
                  style={{ width: iconSize.md, height: iconSize.md }}
                  tintColor={primaryColor}
                />
              ) : (
                <LucideZap size={24} color={primaryColor} />
              )}
            </Box>
            <Box style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="body" style={{ marginBottom: spacing.xs }}>
                Contextual App Detection
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted }}>
                We strictly monitor top-level window transitions to identify
                when a target messaging app is launched. We do NOT read your
                chat messages.
              </Text>
            </Box>
          </Box>

          <Box
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <Box
              style={{
                padding: spacing.md,
                borderRadius: borderRadius.xl,
                backgroundColor: `${color.success}1A`,
              }}
            >
              {isIOS ? (
                <ExpoImage
                  source="sf:battery.100.bolt"
                  style={{ width: iconSize.md, height: iconSize.md }}
                  tintColor={color.success}
                />
              ) : (
                <LucideBatteryCharging size={24} color={color.success} />
              )}
            </Box>
            <Box style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="body" style={{ marginBottom: spacing.xs }}>
                Battery Optimized
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted }}>
                Utilizing native Accessibility signals prevents aggressive
                background polling, ensuring your phone's battery isn't drained.
              </Text>
            </Box>
          </Box>

          <Box
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <Box
              style={{
                padding: spacing.md,
                borderRadius: borderRadius.xl,
                backgroundColor: `${color.info}1A`,
              }}
            >
              {isIOS ? (
                <ExpoImage
                  source="sf:shield.fill"
                  style={{ width: iconSize.md, height: iconSize.md }}
                  tintColor={color.info}
                />
              ) : (
                <LucideShieldCheck size={24} color={color.info} />
              )}
            </Box>
            <Box style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text variant="body" style={{ marginBottom: spacing.xs }}>
                Zero Data Collection
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted }}>
                We{" "}
                <Text variant="bodySmall">
                  do not collect, store, transmit, or share
                </Text>{" "}
                any data, text, or inputs captured by this service. The
                implementation acts exclusively as a local UI trigger.
              </Text>
            </Box>
          </Box>
        </Animated.View>
      </ScrollArea>

      <Box
        style={{
          paddingTop: spacing.md,
          paddingBottom: spacing["2xl"],
          paddingHorizontal: spacing.lg,
          borderTopWidth: 1,
          backgroundColor: color.background,
          borderTopColor: color.border,
        }}
      >
        <Pressable
          onPress={onAgree}
          feedback="none"
          style={{
            width: "100%",
            paddingVertical: spacing.md,
            borderRadius: borderRadius.xl,
            alignItems: "center",
            backgroundColor: primaryColor,
          }}
          accessibilityLabel="I agree to accessibility permissions"
        >
          <Text variant="body" style={{ color: color.onPrimary }}>
            I Agree
          </Text>
        </Pressable>
        <Pressable
          onPress={onDeny}
          feedback="none"
          style={{
            width: "100%",
            paddingVertical: spacing.md,
            marginTop: spacing.xs,
            alignItems: "center",
            borderRadius: borderRadius.xl,
          }}
          accessibilityLabel="Decline accessibility permissions"
        >
          <Text variant="bodySmall" style={{ color: color.muted }}>
            Decline
          </Text>
        </Pressable>
      </Box>
    </Box>
  );
};
