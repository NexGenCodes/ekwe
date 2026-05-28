import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { AuthShell, ErrorBanner, Button, PasswordInput } from "@/components";
import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { resetPasswordSchema, ResetPasswordForm } from "@/schemas/auth";
import { updatePassword } from "@/services/auth";
import { settingsActions } from "@/store";

export default function UpdatePasswordScreen(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { color } = useTheme();
  const primary = color.primary;
  const router = useRouter();
  const { setOnboardingCompleted } = settingsActions;

  const { control, handleSubmit } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: ResetPasswordForm): Promise<void> => {
    setIsLoading(true);
    setError("");
    const r = await updatePassword(data.password);
    setIsLoading(false);

    if (r.ok) {
      setOnboardingCompleted(true);
      router.replace("/(tabs)");
    } else if (r.error) {
      setError(r.error);
    }
  };

  return (
    <AuthShell>
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
          <Lock size={28} color={primary} />
        </Box>
        <Text
          variant="heading1"
          style={{
            textAlign: "center",
          }}
        >
          Choose a new password
        </Text>
        <Text
          variant="body"
          style={{
            marginTop: spacing.sm,
            textAlign: "center",
            color: color.muted,
          }}
        >
          Pick something you haven't used before.
        </Text>
      </Box>

      <Box>
        <ErrorBanner message={error} />

        <Box style={{ gap: spacing.md, marginBottom: spacing.lg }}>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value }, fieldState }) => (
              <PasswordInput
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="New password"
                returnKeyType="next"
                error={fieldState.error?.message}
                showStrength
                autoFocus
              />
            )}
          />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value }, fieldState }) => (
              <PasswordInput
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Confirm new password"
                returnKeyType="done"
                onSubmitEditing={handleSubmit(onSubmit)}
                error={fieldState.error?.message}
              />
            )}
          />
        </Box>

        <Button
          label="Reset Password"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />
      </Box>
    </AuthShell>
  );
}
