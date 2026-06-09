import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import React from "react";
import { Controller, useForm } from "react-hook-form";

import {
  AuthHeader,
  SocialAuthGroup,
  AuthShell,
  Input,
  Divider,
  ErrorBanner,
  Button,
  Disclaimer,
} from "@/components";
import { Box } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useAuthFlow, useNetwork } from "@/hooks";
import { loginSchema, LoginForm } from "@/schemas/auth";
import { sendOtp } from "@/services/auth";

export default function WelcomeScreen(): React.JSX.Element {
  const router = useRouter();

  const { isLoading, error, run, handleApple, handleGoogle } = useAuthFlow();
  const { isOffline } = useNetwork();

  const { control, handleSubmit } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: LoginForm): Promise<void> => {
    const result = await run(() => sendOtp(data.email));
    if (result.ok && result.needsOtp) {
      router.push({
        pathname: "/(auth)/verify",
        params: { email: data.email.trim(), source: "login" },
      });
    }
  };

  return (
    <AuthShell>
      <AuthHeader subtitle="Every voice, understood." />

      <Box>
        <ErrorBanner
          message={
            isOffline
              ? "No internet connection. Please connect to proceed."
              : error
          }
        />

        <Box style={{ gap: spacing.md, marginBottom: spacing.lg }}>
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
                returnKeyType="go"
                textContentType="emailAddress"
                autoComplete="email"
                editable={!isLoading && !isOffline}
                onSubmitEditing={handleSubmit(onSubmit)}
                error={fieldState.error?.message}
              />
            )}
          />
        </Box>

        <Button
          label="Continue with Email"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
          disabled={isOffline}
        />

        <Divider />

        <SocialAuthGroup
          onApple={handleApple}
          onGoogle={handleGoogle}
          disabled={isLoading || isOffline}
        />

        <Disclaimer />
      </Box>
    </AuthShell>
  );
}
