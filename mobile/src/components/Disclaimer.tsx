import { Link } from "expo-router";
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";

import { Box, Pressable, Text } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface DisclaimerProps {
  agreed?: boolean;
  onToggleAgreement?: () => void;
}

const CheckIcon = ({ color }: { color: string }): React.JSX.Element => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Rect x="0.5" y="0.5" width={15} height={15} rx={3} fill="none" />
    <Path d="M4 8l3 3 5-5" stroke={color} strokeWidth={2} fill="none" />
  </Svg>
);

const UncheckedBox = ({
  borderColor,
}: {
  borderColor: string;
}): React.JSX.Element => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Rect
      x="0.5"
      y="0.5"
      width={15}
      height={15}
      rx={3}
      stroke={borderColor}
      strokeWidth={1.5}
      fill="none"
    />
  </Svg>
);

export const Disclaimer: React.FC<DisclaimerProps> = ({
  agreed,
  onToggleAgreement,
}) => {
  const { color } = useTheme();
  return (
    <Animated.View entering={FadeIn.delay(800).duration(1000)}>
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          marginTop: spacing["2xl"],
          marginBottom: spacing.xl,
          paddingHorizontal: spacing.md,
        }}
      >
        {onToggleAgreement && (
          <Pressable
            onPress={onToggleAgreement}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityLabel="Terms and privacy policy consent"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
          >
            {agreed ? (
              <CheckIcon color={color.foreground} />
            ) : (
              <UncheckedBox borderColor={color.border} />
            )}
          </Pressable>
        )}
        <Text
          variant="bodySmall"
          style={{
            textAlign: "center",
            color: color.muted,
            lineHeight: 24,
            flexShrink: 1,
          }}
        >
          By continuing, you agree to our{" "}
          <Link
            href="/legal/terms"
            style={{
              color: color.brand,
              textDecorationLine: "underline",
              padding: spacing.xs,
            }}
            suppressHighlighting
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy"
            style={{
              color: color.brand,
              textDecorationLine: "underline",
              padding: spacing.xs,
            }}
            suppressHighlighting
          >
            Privacy Policy
          </Link>
          .
        </Text>
      </Box>
    </Animated.View>
  );
};


