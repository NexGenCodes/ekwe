import { zodResolver } from "@hookform/resolvers/zod";
import { otpSchema, type OtpForm } from "@ekwe/shared";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import Animated, { FadeInDown } from "react-native-reanimated";

import {
  AuthHeader,
  AuthShell,
  ErrorBanner,
  Button,
  OtpInput,
} from "@/components";
import { Box, Text, Pressable } from "@/components/ui";
import { duration } from "@/constants/motion";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme, useOtpVerify } from "@/hooks";
import { triggerHaptic } from "@/utils/haptics";

const OTP_EXPIRY_HINT = "Codes expire in 10 minutes.";

const formatCooldown = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function VerifyScreen(): React.JSX.Element {
  const router = useRouter();

  const params = useLocalSearchParams<{ email: string }>();
  const email = params.email || "";

  const { color } = useTheme();
  const { isLoading, error, cooldown, verify, resend } = useOtpVerify();
  const [shakeSignal, setShakeSignal] = useState(0);
  const [resent, setResent] = useState(false);
  const [clipboardCode, setClipboardCode] = useState("");

  useEffect(() => {
    let active = true;
    Clipboard.getStringAsync()
      .then((text) => {
        const trimmed = (text ?? "").trim();
        if (active && /^\d{6}$/.test(trimmed)) setClipboardCode(trimmed);
      })
      .catch(() => {});
    return (): void => {
      active = false;
    };
  }, []);

  const { control, handleSubmit, reset, setValue } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { token: "" },
  });

  useEffect(() => {
    if (!resent) return;
    const timer = setTimeout(() => setResent(false), 4000);
    return (): void => clearTimeout(timer);
  }, [resent]);

  const onSubmit = async (data: OtpForm): Promise<void> => {
    const result = await verify(email, data.token);
    if (!result.ok) {
      triggerHaptic(Haptics.NotificationFeedbackType.Error);
      setShakeSignal((s) => s + 1);
      reset({ token: "" });
      return;
    }

    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  };

  const handleResend = async (): Promise<void> => {
    if (cooldown > 0 || isLoading) return;
    setResent(false);
    const ok = await resend(email);
    if (ok) setResent(true);
  };

  const handlePaste = (): void => {
    if (!clipboardCode || isLoading) return;
    triggerHaptic(Haptics.NotificationFeedbackType.Success);
    setValue("token", clipboardCode, { shouldValidate: true });
    setClipboardCode("");
    handleSubmit(onSubmit)();
  };

  return (
    <AuthShell showBackButton>
      <Animated.View entering={FadeInDown.duration(duration.slow).springify()}>
        <AuthHeader
          title="Check your inbox"
          subtitle={`We sent a 6-digit code to ${email}`}
          caption={OTP_EXPIRY_HINT}
        />

        <Box style={{ gap: spacing.md }}>
          <ErrorBanner message={error} />

          <Box style={{ alignItems: "center" }}>
            <Controller
              control={control}
              name="token"
              render={({ field: { onChange, value }, fieldState }) => (
                <OtpInput
                  value={value}
                  onChangeText={(text: string) => onChange(text)}
                  onSubmitEditing={handleSubmit(onSubmit)}
                  error={fieldState.error?.message}
                  autoFocus
                  disabled={isLoading}
                  shakeSignal={shakeSignal}
                />
              )}
            />

            {clipboardCode ? (
              <Pressable
                onPress={handlePaste}
                disabled={isLoading}
                style={{ marginTop: spacing.sm }}
                accessibilityRole="button"
                accessibilityLabel={`Paste code ${clipboardCode}`}
              >
                <Text
                  variant="bodySmall"
                  style={{ color: color.brand, fontWeight: "600" }}
                >
                  Paste code from clipboard
                </Text>
              </Pressable>
            ) : null}
          </Box>

          <Button
            label="Verify Code"
            size="large"
            onPress={handleSubmit(onSubmit)}
            loading={isLoading}
          />

          <Box style={{ alignItems: "center", marginTop: spacing.xs }}>
            {resent ? (
              <Animated.Text
                entering={FadeInDown.duration(duration.fast)}
                style={{
                  color: color.success,
                  fontFamily: typography.bodySmall.fontFamily,
                  fontSize: typography.bodySmall.fontSize,
                  marginBottom: spacing.sm,
                }}
              >
                New code sent. Check your inbox.
              </Animated.Text>
            ) : null}

            <Pressable
              onPress={handleResend}
              disabled={cooldown > 0 || isLoading}
              style={{ alignItems: "center" }}
              accessibilityRole="button"
              accessibilityLabel={
                cooldown > 0
                  ? `Resend code in ${formatCooldown(cooldown)}`
                  : "Resend code"
              }
              accessibilityState={{ disabled: cooldown > 0 || isLoading }}
            >
              <Text
                variant="bodySmall"
                style={{
                  color: color.muted,
                  fontWeight: "500",
                }}
              >
                Didn't receive it?
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  color: cooldown > 0 ? color.muted : color.brand,
                  fontWeight: "600",
                  marginTop: spacing.xs,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {cooldown > 0
                  ? `Resend code in ${formatCooldown(cooldown)}`
                  : "Resend code"}
              </Text>
            </Pressable>

            <Text
              variant="caption"
              style={{
                color: color.disabled,
                marginTop: spacing.sm,
                textAlign: "center",
              }}
            >
              Still stuck? Check your spam folder or try a different email.
            </Text>
          </Box>
        </Box>
      </Animated.View>
    </AuthShell>
  );
}
