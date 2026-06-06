import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import React from "react";
import { Controller, useForm } from "react-hook-form";

import {
  AuthHeader,
  AuthFooter,
  SocialAuthGroup,
  AuthShell,
  Input,
  PasswordInput,
  Divider,
  ErrorBanner,
  Button,
} from "@/components";
import { Box, Text, Pressable } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useAuthFlow, useTheme } from "@/hooks";
import { loginSchema, LoginForm } from "@/schemas/auth";
import { signInWithPassword } from "@/services/auth";

export default function LoginScreen(): React.JSX.Element {
  const router = useRouter();
  const { color } = useTheme();

  const { isLoading, error, run, handleApple, handleGoogle } = useAuthFlow();

  const { control, handleSubmit } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: LoginForm): void => {
    run(() => signInWithPassword(data.email, data.password));
  };

  return (
    <AuthShell>
      <AuthHeader subtitle="Every voice, understood." />

      <Box>
        <ErrorBanner message={error} />

        <Box style={{ gap: spacing.md, marginBottom: spacing.md }}>
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
                returnKeyType="next"
                textContentType="emailAddress"
                autoComplete="email"
                editable={!isLoading}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value }, fieldState }) => (
              <PasswordInput
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Password"
                returnKeyType="done"
                textContentType="password"
                autoComplete="password"
                editable={!isLoading}
                onSubmitEditing={handleSubmit(onSubmit)}
                error={fieldState.error?.message}
              />
            )}
          />
        </Box>

        <Pressable
          onPress={() => router.push("/(auth)/forgot-password")}
          style={{ alignItems: "flex-end", marginBottom: spacing.lg }}
        >
          <Text variant="bodySmall" style={{ color: color.primary }}>
            Forgot password?
          </Text>
        </Pressable>

        <Button
          label="Sign In"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />

        <Divider />

        <SocialAuthGroup
          onApple={handleApple}
          onGoogle={handleGoogle}
          disabled={isLoading}
        />

        <AuthFooter
          text="Don't have an account?"
          linkText="Create one"
          onPress={() => router.push("/(auth)/signup")}
        />
      </Box>
    </AuthShell>
  );
}
