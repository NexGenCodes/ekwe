import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AuthShell, PasswordInput, ErrorBanner, Button } from '@/components';
import { Box, Text } from '@/components/ui';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';
import { resetPasswordSchema, ResetPasswordForm } from '@/schemas/auth';
import { updatePassword } from '@/services/auth';
import { settingsActions } from '@/store';

export default function ResetPasswordScreen(): React.JSX.Element {
  const router = useRouter();
  const { setOnboardingCompleted } = settingsActions;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { color } = useTheme();
  const muted = color.muted;
  const primary = color.primary;

  const { control, handleSubmit } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (data: ResetPasswordForm): Promise<void> => {
    setIsLoading(true);
    setError('');
    const r = await updatePassword(data.password);
    setIsLoading(false);
    if (r.ok) {
      setOnboardingCompleted(true);
      router.replace('/(tabs)');
    } else if (r.error) setError(r.error);
  };

  return (
    <AuthShell>
      <Box style={{ alignItems: 'center', marginBottom: spacing['2xl'] }}>
        <Box
          style={{
            width: 64,
            height: 64,
            borderRadius: borderRadius['2xl'],
            backgroundColor: `${primary}15`,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.md,
          }}
        >
          <KeyRound size={28} color={primary} />
        </Box>
        <Text
          variant="heading1"
          style={{
            textAlign: 'center',
          }}
        >
          Create new password
        </Text>
        <Text
          variant="body"
          style={{
            color: muted,
            marginTop: spacing.sm,
            textAlign: 'center',
          }}
        >
          Choose a strong password for your Ekwe account.
        </Text>
      </Box>
      <Box>
        <ErrorBanner message={error} />
        <Box style={{ gap: spacing.md, marginBottom: spacing.sm }}>
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
                autoFocus
                error={fieldState.error?.message}
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
        <Text
          variant="bodySmall"
          style={{
            color: muted,
            marginBottom: spacing.lg,
            paddingHorizontal: spacing.xs,
          }}
        >
          Password must be at least 8 characters
        </Text>
        <Button
          label="Update Password"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />
      </Box>
    </AuthShell>
  );
}
