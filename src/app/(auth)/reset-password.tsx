import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AuthShell } from '@/components';
import { PasswordInput, ErrorBanner, Button } from '@/components/ui';
import { borderRadius, spacing, typography } from '@/constants/designTokens';
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
  const fg = color.foreground;
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
      <Animated.View
        entering={FadeInDown.duration(600).springify()}
        style={{ alignItems: 'center', marginBottom: spacing[10] }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: borderRadius['2xl'],
            backgroundColor: `${primary}15`,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing[4],
          }}
        >
          <KeyRound size={28} color={primary} />
        </View>
        <Text
          style={{
            fontFamily: 'Outfit-Medium',
            fontSize: typography.heading1.size,
            color: fg,
            letterSpacing: -0.5,
            textAlign: 'center',
          }}
        >
          Create new password
        </Text>
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: typography.body.size - 1,
            color: muted,
            marginTop: spacing[2],
            textAlign: 'center',
            lineHeight: typography.body.lineHeight,
          }}
        >
          Choose a strong password for your Ekwe account.
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.duration(600).delay(100).springify()}>
        <ErrorBanner message={error} />
        <View style={{ gap: spacing[3], marginBottom: spacing[2] }}>
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
        </View>
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: typography.bodySmall.size + 1,
            color: muted,
            marginBottom: spacing[5],
            paddingHorizontal: spacing[1],
          }}
        >
          Password must be at least 8 characters
        </Text>
        <Button
          label="Update Password"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
        />
      </Animated.View>
    </AuthShell>
  );
}
