import { BlurView } from "expo-blur";
import { Image as ExpoImage } from "expo-image";
import {
  LucideShieldCheck,
  LucideBatteryCharging,
  LucideZap,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button } from "@/components/Button";
import { Box, Text, ScrollArea } from "@/components/ui";
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
  const { color, isDark } = useTheme();
  const primaryColor = color.primary;

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      <ScrollArea
        style={{ flex: 1 }}
        contentContainerStyle={{ 
          paddingHorizontal: spacing.lg,
          paddingBottom: 160 // Room for floating footer
        }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View
          entering={FadeInDown.duration(500).springify()}
          style={{ marginTop: spacing.xl, marginBottom: spacing.xl }}
        >
          <Text variant="display" style={{ letterSpacing: -0.5 }}>
            Accessibility Service Disclosure
          </Text>
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
              <Text variant="bodySmall" style={{ fontFamily: "SpaceMono-Regular" }}>AccessibilityService API</Text> to
              detect when you open messaging applications (like WhatsApp or
              Tinder). This allows Ekwe to automatically display the floating
              translation tool over your screen exactly when you need it.
            </Text>
          </Box>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(500).delay(100).springify()}
          style={{ gap: spacing.lg }}
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
              <Text variant="body" style={{ marginBottom: spacing.xs, letterSpacing: -0.2 }}>
                Contextual App Detection
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted, lineHeight: 20 }}>
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
              <Text variant="body" style={{ marginBottom: spacing.xs, letterSpacing: -0.2 }}>
                Battery Optimized
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted, lineHeight: 20 }}>
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
              <Text variant="body" style={{ marginBottom: spacing.xs, letterSpacing: -0.2 }}>
                Zero Data Collection
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted, lineHeight: 20 }}>
                We{" "}
                <Text variant="bodySmall" style={{ color: color.foreground }}>
                  do not collect, store, transmit, or share
                </Text>{" "}
                any data, text, or inputs captured by this service. The
                implementation acts exclusively as a local UI trigger.
              </Text>
            </Box>
          </Box>
        </Animated.View>
      </ScrollArea>

      {/* Floating Blurred Footer */}
      <View style={styles.footerContainer}>
        <BlurView
          intensity={80}
          tint={isDark ? "dark" : "light"}
          style={[
            styles.blurView,
            {
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing["3xl"],
              paddingTop: spacing.md,
              borderTopWidth: 1,
              borderTopColor: color.border + "80", // 50% opacity border
              backgroundColor: color.background + "99", // 60% opacity background
            },
          ]}
        >
          <Button
            variant="primary"
            size="large"
            label="I Agree"
            onPress={onAgree}
            style={{ width: "100%" }}
            accessibilityLabel="I agree to accessibility permissions"
          />
          <Button
            variant="ghost"
            size="medium"
            label="Decline"
            onPress={onDeny}
            style={{ width: "100%", marginTop: spacing.xs }}
            labelStyle={{ color: color.muted }}
            accessibilityLabel="Decline accessibility permissions"
          />
        </BlurView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  footerContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  blurView: {
    width: "100%",
  },
});
