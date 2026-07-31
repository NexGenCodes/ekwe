import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";
import { triggerHaptic } from "@/utils/haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
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
import { useTheme, useOtpVerify } from "@/hooks";
import { otpSchema, OtpForm } from "@/schemas/auth";

export default function VerifyScreen(): React.JSX.Element {
  const router = useRouter();

  const params = useLocalSearchParams<{ email: string; source?: string }>();
  const email = params.email || "";

  const { color } = useTheme();
  const { isLoading, error, cooldown, verify, resend } = useOtpVerify();

  const { control, handleSubmit } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { token: "" },
  });

  const onSubmit = async (data: OtpForm): Promise<void> => {
    const type: "signup" | "email" =
      params.source === "signup" ? "signup" : "email";
    const result = await verify(email, data.token, type);
    if (result.ok) {
      triggerHaptic(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    }
  };

  const handleResend = async (): Promise<void> => {
    if (cooldown > 0) return;
    await resend(email);
  };

  return (
    <AuthShell showBackButton>
      <Animated.View entering={FadeInDown.duration(duration.slow).springify()}>
        <AuthHeader
          subtitle="Check your inbox"
          caption={`We sent a code to ${email}`}
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
                  onChangeText={(text: string) => {
                    onChange(text);
                    if (text.length === 6) {
                      handleSubmit(onSubmit)();
                    }
                  }}
                  onSubmitEditing={handleSubmit(onSubmit)}
                  error={fieldState.error?.message}
                />
              )}
            />
          </Box>

          <Button
            label="Verify Code"
            onPress={handleSubmit(onSubmit)}
            loading={isLoading}
          />

          <Pressable
            onPress={handleResend}
            disabled={cooldown > 0 || isLoading}
            style={{ alignItems: "center" }}
            accessibilityLabel={
              cooldown > 0
                ? `Resend code in ${cooldown} seconds`
                : "Resend code"
            }
          >
            <Text variant="bodySmall" style={{ color: color.muted }}>
              Didn't receive it?
            </Text>
            <Text
              variant="bodySmall"
              style={{
                color: cooldown > 0 ? color.muted : color.foreground,
                marginTop: spacing.xs,
              }}
            >
              {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
            </Text>
          </Pressable>
        </Box>
      </Animated.View>
    </AuthShell>
  );
}
