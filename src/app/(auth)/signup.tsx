import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';

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
  Disclaimer,
} from '@/components';
import { Box, Text } from '@/components/ui';
import { spacing } from '@/constants/spacing';
import { useAuthFlow, useTheme } from '@/hooks';
import { signupSchema, SignupForm } from '@/schemas/auth';
import { signUpWithPassword } from '@/services/auth';

export default function SignupScreen(): React.JSX.Element {
  const router = useRouter();
  const { color } = useTheme();

  const { isLoading, error, run, handleApple, handleGoogle, onSuccess } =
    useAuthFlow();

  const { control, handleSubmit } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (data: SignupForm): Promise<void> => {
    const result = await run(() =>
      signUpWithPassword(data.email, data.password),
    );
    if (result.ok && result.needsOtp) {
      router.push({
        pathname: '/(auth)/verify',
        params: { email: data.email.trim(), source: 'signup' },
      });
    }
  };

  // Social auth creates account automatically if new
  const onApple = async (): Promise<void> => {
    const result = await handleApple();
    if (result.ok) onSuccess();
  };

  const onGoogle = async (): Promise<void> => {
    const result = await handleGoogle();
    if (result.ok) onSuccess();
  };

  return (
    <AuthShell showBackButton>
      <AuthHeader subtitle="Create your account" />

      <Box>
        <ErrorBanner message={error} />

        <Box style={{ gap: spacing.md, marginBottom: spacing.sm }}>
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
                returnKeyType="next"
                error={fieldState.error?.message}
                showStrength={true}
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
                placeholder="Confirm password"
                returnKeyType="done"
                onSubmitEditing={handleSubmit(onSubmit)}
                error={fieldState.error?.message}
              />
            )}
          />
        </Box>

        <Button
          label="Create Account"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />

        <Divider />

        <SocialAuthGroup
          onApple={onApple}
          onGoogle={onGoogle}
          action="sign-up"
          disabled={isLoading}
        />

        <AuthFooter
          text="Already have an account?"
          linkText="Sign in"
          onPress={() => router.back()}
        />

        <Disclaimer />
      </Box>
    </AuthShell>
  );
}
