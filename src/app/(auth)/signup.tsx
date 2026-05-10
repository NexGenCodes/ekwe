import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  View,
  Text,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AuthHeader, AuthFooter, SocialAuthGroup } from '@/components/features/auth';
import { Input, PasswordInput, Divider, ErrorBanner, Button, AuthShell } from '@/components/ui';
import { useAuthFlow } from '@/hooks';
import { useTheme } from '@/hooks';
import { signUpWithPassword } from '@/services/auth';
import { signupSchema, SignupForm } from '@/schemas/auth';

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

          <Animated.View
            entering={FadeInDown.duration(600).delay(100).springify()}
          >
            <ErrorBanner message={error} />

            <View style={{ gap: 12, marginBottom: 8 }}>
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
            </View>

            <Text
              style={{
                fontFamily: 'Outfit-Regular',
                fontSize: 13,
                color: color.muted,
                marginBottom: 20,
                paddingHorizontal: 4,
              }}
            >
              Password must be at least 8 characters
            </Text>

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
            />

            <AuthFooter
              text="Already have an account?"
              linkText="Sign in"
              onPress={() => router.back()}
            />
          </Animated.View>
    </AuthShell>
  );
}
