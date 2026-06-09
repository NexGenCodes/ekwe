/**
 * SocialButton — Apple / Google sign-in button.
 *
 * Apple button auto-hides on Android.
 */
import React from "react";
import Svg, { Path, G, ClipPath, Defs } from "react-native-svg";

import { Pressable, Text, Box } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface SocialButtonProps {
  provider: "apple" | "google";
  action?: "sign-in" | "sign-up";
  onPress: () => void;
  disabled?: boolean;
  comingSoon?: boolean;
}

/** Official multicolour Google "G" logo */
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

/** Apple logo using an SVG path */
const AppleLogo = ({ color }: { color: string }): React.ReactElement => (
  <Svg width={20} height={20} viewBox="0 0 170 170">
    <Path
      fill={color}
      d="M150.37,130.25c-2.45,5.66-5.35,10.87-8.71,15.66-4.58,6.53-8.33,11.05-11.22,13.56-4.48,4.12-9.28,6.23-14.42,6.35-3.69,0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58,0-9.49,1.05-14.75,3.17-5.26,2.13-9.5,3.24-12.74,3.35-4.92,.21-9.84-1.96-14.75-6.53-3.11-2.91-7.16-7.79-12.16-14.63-7.51-10.22-13.62-22.18-18.32-35.88-4.71-13.7-7.06-25.79-7.06-36.27,0-15.02,3.88-26.68,11.63-34.98,7.57-7.98,16.89-12.12,27.97-12.43,5.18-.1,10.51,1.52,15.98,4.86,5.46,3.33,9.01,5.01,10.66,5.01,1.38,0,5.17-1.78,11.37-5.33,6.2-3.56,12.08-5.1,17.65-4.63,7.54,.45,14.07,2.83,19.59,7.15,5.52,4.32,9.39,9.45,11.63,15.4-11.27,6.6-16.71,15.86-16.32,27.76,.39,11.38,5.43,20.25,15.11,26.6,0,0-.72,1.86-1.55,4.12z"
    />
    <Path
      fill={color}
      d="M115.94,36.52c-4.44-5.38-9.89-9.15-16.33-11.34-1.32-4.58-1.73-9.56-1.23-14.94,5.49,.62,11.19,3.01,17.08,7.18,5.9,4.16,10.22,9.66,12.98,16.5-1.33,4.11-2.06,8.74-2.18,13.88-4.14-.8-7.71-4.56-10.32-11.28z"
    />
  </Svg>
);

export const SocialButton = ({
  provider,
  action = "sign-in",
  onPress,
  disabled = false,
  comingSoon = false,
}: SocialButtonProps): React.ReactElement | null => {
  const { color, isDark } = useTheme();

  const label = provider === "google" ? "Google" : "Apple";

  const isApple = provider === "apple";
  const bgColor = isApple
    ? isDark
      ? color.foreground
      : "#000000"
    : color.card;
  const textColor = isApple
    ? isDark
      ? color.background
      : "#FFFFFF"
    : color.foreground;
  const borderColor = isApple ? bgColor : color.border;

  return (
    <Pressable
      onPress={disabled || comingSoon ? undefined : onPress}
      feedback="scale"
      disabled={disabled || comingSoon}
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
        opacity: disabled || comingSoon ? 0.5 : 1,
      }}
      accessibilityLabel={`${action === "sign-in" ? "Sign in" : "Sign up"} with ${label}`}
    >
      {provider === "google" ? <GoogleLogo /> : <AppleLogo color={textColor} />}
      <Box
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
      >
        <Text variant="body" style={{ color: textColor }}>
          {label}
        </Text>
        {comingSoon && (
          <Box
            style={{
              backgroundColor: color.muted,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 10,
            }}
          >
            <Text
              variant="caption"
              style={{ color: color.background, fontSize: 10 }}
            >
              Soon
            </Text>
          </Box>
        )}
      </Box>
    </Pressable>
  );
};
