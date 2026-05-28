import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState, useEffect, useCallback } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  AuthHeader,
  AuthShell,
  Input,
  ErrorBanner,
  Button,
} from "@/components";
import { Box, Text, Pressable } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";
import { otpSchema, OtpForm } from "@/schemas/auth";
import { verifyOtp, sendOtp } from "@/services/auth";
import { settingsActions } from "@/store";

const RESEND_COOLDOWN = 60;

export default function VerifyScreen(): React.JSX.Element {
  const router = useRouter();
  const { setOnboardingCompleted } = settingsActions;
  const params = useLocalSearchParams<{ email: string; source: string }>();
  const email = params.email || "";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  const { color } = useTheme();

  const { control, handleSubmit } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { token: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [cooldown]);

  const onSubmit = useCallback(
    async (data: OtpForm): Promise<void> => {
      setIsLoading(true);
      setError("");
      const result = await verifyOtp(email, data.token);
      setIsLoading(false);

      if (result.ok) {
        if (params.source === "forgot-password") {
          router.replace("/(auth)/update-password");
        } else {
          setOnboardingCompleted(true);
          router.replace("/(tabs)");
        }
      } else if (result.error) {
        setError(result.error);
      }
    },
    [email, params.source, setOnboardingCompleted, router],
  );

  const handleResend = async (): Promise<void> => {
    if (cooldown > 0) return;
    setIsLoading(true);
    setError("");
    const result = await sendOtp(email);
    setIsLoading(false);
    if (result.ok) setCooldown(RESEND_COOLDOWN);
    else if (result.error) setError(result.error);
  };

  return (
    <AuthShell showBackButton>
      <AuthHeader
        subtitle="Check your inbox"
        caption={`We sent a code to ${email}`}
      />

      <Box>
        <ErrorBanner message={error} />

        <Box style={{ marginBottom: spacing.lg }}>
          <Controller
            control={control}
            name="token"
            render={({ field: { onChange, value }, fieldState }) => (
              <Input
                value={value}
                onChangeText={onChange}
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                onSubmitEditing={handleSubmit(onSubmit)}
                autoFocus
                error={fieldState.error?.message}
                style={[
                  {
                    ...typography.heading2,
                    textAlign: "center",
                    letterSpacing: 8,
                    color: color.foreground,
                  },
                ]}
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
          style={{ alignItems: "center", marginTop: spacing.lg }}
        >
          <Text variant="bodySmall" style={{ color: color.muted }}>
            Didn't receive it?
          </Text>
          <Text
            variant="bodySmall"
            style={{
              color: cooldown > 0 ? color.muted : color.primary,
              marginTop: spacing.xs,
            }}
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </Text>
        </Pressable>
      </Box>
    </AuthShell>
  );
}
