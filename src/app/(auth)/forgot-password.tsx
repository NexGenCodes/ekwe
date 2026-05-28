import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { Mail } from "lucide-react-native";
import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { AuthShell, Input, ErrorBanner, Button } from "@/components";
import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { forgotPasswordSchema, ForgotPasswordForm } from "@/schemas/auth";
import { sendPasswordResetOtp } from "@/services/auth";

export default function ForgotPasswordScreen(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { color } = useTheme();
  const primary = color.primary;
  const router = useRouter();

  const { control, handleSubmit } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordForm): Promise<void> => {
    setIsLoading(true);
    setError("");
    const r = await sendPasswordResetOtp(data.email);
    setIsLoading(false);
    if (r.ok) {
      router.push({
        pathname: "/(auth)/verify",
        params: { email: data.email.trim(), source: "forgot-password" },
      });
    } else if (r.error) {
      setError(r.error);
    }
  };

  return (
    <AuthShell showBackButton>
      <Box style={{ alignItems: "center", marginBottom: spacing["2xl"] }}>
        <Box
          style={{
            width: 64,
            height: 64,
            borderRadius: borderRadius["2xl"],
            backgroundColor: `${primary}15`,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.md,
          }}
        >
          <Mail size={28} color={primary} />
        </Box>
        <Text
          variant="heading1"
          style={{
            textAlign: "center",
          }}
        >
          Forgot your password?
        </Text>
        <Text
          variant="body"
          style={{
            marginTop: spacing.sm,
            textAlign: "center",
            color: color.muted,
          }}
        >
          No worries. Enter your email and we'll send a reset code.
        </Text>
      </Box>
      <Box>
        <ErrorBanner message={error} />
        <Box style={{ marginBottom: spacing.lg }}>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value }, fieldState }) => (
              <Input
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Email address"
                keyboardType="email-address"
                returnKeyType="done"
                onSubmitEditing={handleSubmit(onSubmit)}
                autoFocus
                error={fieldState.error?.message}
              />
            )}
          />
        </Box>

        <Button
          label="Send Code"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />
      </Box>
    </AuthShell>
  );
}
