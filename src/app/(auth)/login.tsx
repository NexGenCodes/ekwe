import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { useSettingsStore } from '@/store';
import logger from '@/utils/logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const iconLight = require('../../../assets/icon-light.png');
const iconDark = require('../../../assets/icon.png');
// eslint-disable-next-line @typescript-eslint/no-var-requires

export default function LoginScreen(): React.JSX.Element {
  const router = useRouter();
  const { setOnboardingCompleted } = useSettingsStore();

  const [email, setEmail] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  const handleAuthSuccess = (): void => {
    setOnboardingCompleted(true);
    router.replace('/(tabs)');
  };

  const handleSendOtp = async (): Promise<void> => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
      });
      if (error) throw error;
      setStep('otp');
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.info('[Login] email OTP error:', err.message);
        setError(err.message);
      } else {
        setError('Failed to send verification code.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (): Promise<void> => {
    if (!otpToken || otpToken.length < 6) {
      setError('Please enter the 6-digit code.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpToken.trim(),
        type: 'email',
      });
      if (error) throw error;
      if (data.session) {
        handleAuthSuccess();
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.info('[Login] OTP verification error:', err.message);
        setError(err.message);
      } else {
        setError('Invalid code. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: getColor('background', isDark) }}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Brand Lockup */}
          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).springify()}
            style={{ alignItems: 'center', marginBottom: 48 }}
          >
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                overflow: 'hidden',
                marginBottom: 16,
              }}
            >
              <Image
                source={isDark ? iconDark : iconLight}
                style={{ width: 72, height: 72 }}
                resizeMode="cover"
              />
            </View>
            <Text
              className="font-display"
              style={{
                fontSize: 40,
                color: getColor('foreground', isDark),
                letterSpacing: -0.5,
              }}
            >
              Ekwe
            </Text>
            <Text
              style={{
                fontFamily: 'Outfit-Regular',
                fontSize: 16,
                color: getColor('muted', isDark),
                marginTop: 8,
              }}
            >
              {step === 'email'
                ? 'Every voice, understood.'
                : 'Check your email'}
            </Text>
            {step === 'otp' && (
              <Text
                style={{
                  fontFamily: 'Outfit-Regular',
                  fontSize: 14,
                  color: getColor('muted', isDark),
                  marginTop: 4,
                }}
              >
                We sent a code to {email}
              </Text>
            )}
          </Animated.View>

          {/* Form Section */}
          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).delay(100).springify()}
          >
            {error ? (
              <View
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(239, 68, 68, 0.15)',
                }}
              >
                <Text
                  style={{
                    color: '#EF4444',
                    fontFamily: 'Outfit-Medium',
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {step === 'email' ? (
              <>
                <View style={{ marginBottom: 16 }}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={email}
                    placeholder="Email address"
                    placeholderTextColor={getColor('muted', isDark)}
                    onChangeText={(text) => {
                      setEmail(text);
                      setError('');
                    }}
                    style={{
                      backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                      borderRadius: 16,
                      padding: 18,
                      color: getColor('foreground', isDark),
                      fontFamily: 'Outfit-Regular',
                      fontSize: 16,
                    }}
                    keyboardType="email-address"
                    onSubmitEditing={handleSendOtp}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSendOtp}
                  disabled={isLoading || !email}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: primaryColor,
                    borderRadius: 16,
                    padding: 18,
                    alignItems: 'center',
                    opacity: isLoading || !email ? 0.7 : 1,
                  }}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text
                      style={{
                        color: 'white',
                        fontFamily: 'Outfit-Medium',
                        fontSize: 16,
                      }}
                    >
                      Continue
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={{ marginBottom: 16 }}>
                  <TextInput
                    autoCapitalize="none"
                    value={otpToken}
                    placeholder="123456"
                    placeholderTextColor={getColor('muted', isDark)}
                    onChangeText={(text) => {
                      setOtpToken(text);
                      setError('');
                    }}
                    style={{
                      backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                      borderRadius: 16,
                      padding: 18,
                      color: getColor('foreground', isDark),
                      fontFamily: 'Outfit-Medium',
                      fontSize: 24,
                      textAlign: 'center',
                      letterSpacing: 8,
                    }}
                    keyboardType="number-pad"
                    maxLength={6}
                    onSubmitEditing={handleVerifyOtp}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  onPress={handleVerifyOtp}
                  disabled={isLoading || otpToken.length < 6}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: primaryColor,
                    borderRadius: 16,
                    padding: 18,
                    alignItems: 'center',
                    opacity: isLoading || otpToken.length < 6 ? 0.7 : 1,
                  }}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text
                      style={{
                        color: 'white',
                        fontFamily: 'Outfit-Medium',
                        fontSize: 16,
                      }}
                    >
                      Verify Code
                    </Text>
                  )}
                </TouchableOpacity>

                <Pressable
                  onPress={() => {
                    setStep('email');
                    setOtpToken('');
                    setError('');
                  }}
                  style={{
                    marginTop: 24,
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ChevronLeft size={16} color={getColor('muted', isDark)} />
                  <Text
                    style={{
                      fontFamily: 'Outfit-Medium',
                      fontSize: 14,
                      color: getColor('muted', isDark),
                    }}
                  >
                    Back to login
                  </Text>
                </Pressable>
              </>
            )}
          </Animated.View>

          {/* ToS Footer — flows with content, no absolute positioning */}
          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).delay(200).springify()}
            style={{ marginTop: 48, paddingBottom: 24 }}
          >
            <Text
              style={{
                fontFamily: 'Outfit-Regular',
                fontSize: 12,
                color: getColor('muted', isDark),
                textAlign: 'center',
                lineHeight: 18,
              }}
            >
              By continuing, you agree to our{'\n'}
              <Text
                style={{ color: primaryColor, fontFamily: 'Outfit-Medium' }}
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                style={{ color: primaryColor, fontFamily: 'Outfit-Medium' }}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
