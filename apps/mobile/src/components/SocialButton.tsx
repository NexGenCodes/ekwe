import React from "react";
import Svg, { Path, G, ClipPath, Defs } from "react-native-svg";

import { Pressable, Text, Box, Spinner } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

interface SocialButtonProps {
  provider: "apple" | "google";
  action?: "sign-in" | "sign-up";
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

const GoogleLogo = (): React.ReactElement => (
  <Svg width={20} height={20} viewBox="0 0 48 48">
    <Defs>
      <ClipPath id="g">
        <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" />
      </ClipPath>
    </Defs>
    <G clipPath="url(#g)">
      <Path d="M0 37V11l17 13z" fill="#FBBC05" />
      <Path d="M0 11l17 13 7-6.1L48 14V0H0z" fill="#EA4335" />
      <Path d="M0 37l30-23 7.9 1L48 0v48H0z" fill="#34A853" />
      <Path d="M48 48L17 24l-4-3 35-10z" fill="#4285F4" />
    </G>
  </Svg>
);

const AppleLogo = ({ color }: { color: string }): React.ReactElement => (
  <Svg width={20} height={20} viewBox="0 0 814 1000">
    <Path
      fill={color}
      d="M788.1,340.9c-5.8,4.5-108.2,62.2-108.2,190.5c0,148.4,130.3,200.9,134.2,202.2c-0.6,3.2-20.7,71.9-68.7,141.9c-42.8,61.6-87.5,123.1-155.5,123.1s-85.5-39.5-164-39.5c-76.5,0-103.7,40.8-165.9,40.8s-105.6-57.4-155.5-127.4C39.2,772.7,0,624.7,0,485.8C0,310.6,100.8,218.4,199.4,218.4c66.1,0,121,44.2,162.7,44.2c39.5,0,101.1-46.9,175.6-46.9c28.5,0,130.9,2.6,198.3,99.2H788.1z M554.1,159.4c31.1-36.9,53.1-88.1,53.1-139.3c0-7.1-0.6-14.3-1.9-20.1c-50.6,1.9-110.8,33.7-147.1,75.8c-28.5,32.4-55.1,83.6-55.1,135.5c0,7.8,1.3,15.6,1.9,18.1c3.2,0.6,8.4,1.3,13.6,1.3C460,230.7,521.1,200.3,554.1,159.4z"
    />
  </Svg>
);

export const SocialButton = ({
  provider,
  action = "sign-in",
  onPress,
  disabled = false,
  loading = false,
}: SocialButtonProps): React.ReactElement | null => {
  const { color } = useTheme();

  const label = provider === "google" ? "Google" : "Apple";

  const isApple = provider === "apple";
  const unavailable = isApple && !isIOS;
  const isDisabled = disabled || unavailable || loading;

  const bgColor = isApple ? color.foreground : color.card;
  const textColor = isApple ? color.background : color.foreground;
  const borderColor = isApple ? bgColor : color.border;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      feedback="scale"
      disabled={isDisabled}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        backgroundColor: bgColor,
        borderRadius: borderRadius.xl,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderWidth: 1,
        borderColor,
        opacity: isDisabled && !loading ? 0.45 : 1,
      }}
      accessibilityLabel={`${action === "sign-in" ? "Sign in" : "Sign up"} with ${label}`}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={
        unavailable
          ? "Sign in with Apple is only available on iPhone"
          : undefined
      }
    >
      {loading ? (
        <Spinner size="sm" color={textColor} />
      ) : provider === "google" ? (
        <GoogleLogo />
      ) : (
        <AppleLogo color={textColor} />
      )}
      <Box
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
      >
        <Text variant="body" style={{ color: textColor }}>
          {loading ? "Connecting…" : label}
        </Text>
      </Box>
    </Pressable>
  );
};
