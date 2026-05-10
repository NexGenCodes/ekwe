import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  View,
  Pressable, Text
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';


import { AuthHeader, AuthFooter, SocialAuthGroup } from '@/components/features/auth';
import { Input, PasswordInput, Divider, ErrorBanner, Button, AuthShell } from '@/components/ui';
import { useAuthFlow } from '@/hooks';
import { useTheme } from '@/hooks';
import { signInWithPassword, sendOtp } from '@/services/auth';
import { loginSchema, LoginForm } from '@/schemas/auth';

export default function LoginScreen(): React.JSX.Element {
  const router = useRouter();
  const { color } = useTheme();

  const { isLoading, error, setError, run, handleApple, handleGoogle } =
    useAuthFlow();

  const { control, handleSubmit, getValues } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (data: LoginForm): void => {
    run(() => signInWithPassword(data.email, data.password));
  };

  const handleOtpFallback = async (): Promise<void> => {
    const email = getValues('email');
    if (!email) {
      setError('Enter your email first.');
      return;
    }
    const result = await run(() => sendOtp(email));
    if (result.ok) {
      router.push({
        pathname: '/(auth)/verify',
        params: { email: email.trim(), source: 'otp' },
      });
    }
  };

  return (
    <AuthShell>
      <AuthHeader subtitle="Every voice, understood." />

      <Animated.View
        entering={FadeInDown.duration(600).delay(100).springify()}
      >
        <ErrorBanner message={error} />

        <View style={{ gap: 12, marginBottom: 12 }}>
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
                returnKeyType="done"
                onSubmitEditing={handleSubmit(onSubmit)}
                error={fieldState.error?.message}
              />
            )}
          />
        </View>

        <Pressable
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ alignItems: 'flex-end', marginBottom: 20 }}
        >
          <Text
            style={{
              fontFamily: 'Outfit-Medium',
              fontSize: 14,
              color: color.primary,
            }}
          >
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
        />

        <Pressable
          onPress={handleOtpFallback}
          disabled={isLoading}
          style={{ alignItems: 'center', marginTop: 20 }}
        >
          <Text
            style={{
              fontFamily: 'Outfit-Medium',
              fontSize: 14,
              color: color.muted,
            }}
          >
            Continue with email code →
          </Text>
        </Pressable>

        <AuthFooter
          text="Don't have an account?"
          linkText="Create one"
          onPress={() => router.push('/(auth)/signup')}
        />
      </Animated.View>
    </AuthShell>
  );
}
