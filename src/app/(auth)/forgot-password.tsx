import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, CheckCircle2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View, Text, Pressable, Linking, Platform } from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components';
import { Input, ErrorBanner, Button } from '@/components/ui';
import { borderRadius, spacing, typography } from '@/constants/designTokens';
import { useTheme } from '@/hooks';
import { forgotPasswordSchema, ForgotPasswordForm } from '@/schemas/auth';
import { sendPasswordReset } from '@/services/auth';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const { color } = useTheme();
  const fg = color.foreground;
  const muted = color.muted;
  const primary = color.primary;

  const { control, handleSubmit, getValues } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordForm): Promise<void> => {
    setIsLoading(true);
    setError('');
    const r = await sendPasswordReset(data.email);
    setIsLoading(false);
    if (r.ok) setSent(true);
    else if (r.error) setError(r.error);
  };

  return (
    <AuthShell showBackButton>
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
          <Mail size={28} color={primary} />
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
          Reset your password
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
          {sent
            ? "We've sent a reset link to your email."
            : "Enter your email and we'll send you a link."}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.duration(600).delay(100).springify()}>
        {sent ? (
          <Animated.View
            entering={FadeIn.duration(400)}
            style={{
              backgroundColor: 'rgba(16,185,129,0.08)',
              borderRadius: borderRadius['2xl'],
              padding: spacing[6],
              alignItems: 'center',
              borderWidth: 1,
              borderColor: 'rgba(16,185,129,0.15)',
            }}
          >
            <CheckCircle2
              size={32}
              color="#10B981"
              style={{ marginBottom: spacing[3] }}
            />
            <Text
              style={{
                fontFamily: 'Outfit-Medium',
                fontSize: typography.body.size,
                color: fg,
                textAlign: 'center',
                marginBottom: spacing[1],
              }}
            >
              Check your inbox!
            </Text>
            <Text
              style={{
                fontFamily: 'Outfit-Regular',
                fontSize: typography.bodySmall.size,
                color: muted,
                textAlign: 'center',
                marginBottom: spacing[4],
              }}
            >
              We sent a reset link to {getValues('email')}
            </Text>
            <Pressable
              onPress={() =>
                Linking.openURL(
                  Platform.OS === 'ios' ? 'message://' : 'mailto:',
                )
              }
            >
              <Text
                style={{
                  fontFamily: 'Outfit-Medium',
                  fontSize: typography.bodySmall.size,
                  color: primary,
                }}
              >
                Open mail app →
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <ErrorBanner message={error} />
            <View style={{ marginBottom: spacing[5] }}>
              <Controller
                control={control}
                name="email"
                render={({
                  field: { onChange, onBlur, value },
                  fieldState,
                }) => (
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
            </View>
            <Button
              label="Send Reset Link"
              onPress={handleSubmit(onSubmit)}
              loading={isLoading}
            />
          </>
        )}
      </Animated.View>
    </AuthShell>
  );
}
