import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
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
} from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweWordmark } from '@/assets/icons/EkweWordmark';
import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { useSettingsStore } from '@/store';
import logger from '@/utils/logger';

// Configure Google Sign-In with your client IDs
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

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

  interface AuthError {
    code?: string;
    message?: string;
  }

  const onGoogleSignIn = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError('');
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      if (userInfo?.data?.idToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: userInfo.data.idToken,
        });
        if (error) throw error;
        handleAuthSuccess();
      } else {
        throw new Error('no ID token present!');
      }
    } catch (error: unknown) {
      const e = error as AuthError;
      if (e.code !== 'SIGN_IN_CANCELLED' && e.code !== 'IN_PROGRESS') {
        logger.warn('[Google OAuth] error:', error);
        setError('Failed to sign in with Google.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onAppleSignIn = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError('');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) throw error;
        handleAuthSuccess();
      } else {
        throw new Error('No identityToken.');
      }
    } catch (error: unknown) {
      const e = error as AuthError;
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        logger.warn('[Apple OAuth] error:', error);
        setError('Failed to sign in with Apple.');
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'center', padding: 32 }}>
          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).springify()}
            style={{ alignItems: 'center', marginBottom: 48 }}
          >
            <EkweWordmark size={72} color={getColor('foreground', isDark)} />
            <Text
              style={{
                fontFamily: 'Outfit-Regular',
                fontSize: 16,
                color: getColor('muted', isDark),
                marginTop: 8,
              }}
            >
              {step === 'email' ? 'Every voice, secured.' : 'Check your email'}
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

          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).delay(100).springify()}
          >
            {error ? (
              <View
                style={{
                  backgroundColor: 'rgba(255, 0, 0, 0.1)',
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 16,
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

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginVertical: 32,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      height: 1,
                      backgroundColor: getColor('border', isDark),
                    }}
                  />
                  <Text
                    style={{
                      marginHorizontal: 16,
                      color: getColor('muted', isDark),
                      fontFamily: 'Outfit-Medium',
                      fontSize: 14,
                    }}
                  >
                    OR
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      height: 1,
                      backgroundColor: getColor('border', isDark),
                    }}
                  />
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 16,
                  }}
                >
                  {Platform.OS === 'ios' && (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={
                        AppleAuthentication.AppleAuthenticationButtonType
                          .SIGN_IN
                      }
                      buttonStyle={
                        isDark
                          ? AppleAuthentication.AppleAuthenticationButtonStyle
                              .WHITE
                          : AppleAuthentication.AppleAuthenticationButtonStyle
                              .BLACK
                      }
                      cornerRadius={30}
                      style={{ width: 60, height: 60 }}
                      onPress={onAppleSignIn}
                    />
                  )}
                  {/* Mock Google Logo Button (Requires SVGs in a real setup, using a styled G here) */}
                  <TouchableOpacity
                    onPress={onGoogleSignIn}
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 30,
                      backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 24,
                        fontWeight: '700',
                        color: isDark ? 'white' : 'black',
                      }}
                    >
                      G
                    </Text>
                  </TouchableOpacity>
                </View>
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

          <Animated.View
            layout={Layout.springify()}
            entering={FadeInDown.duration(600).delay(200).springify()}
            style={{ position: 'absolute', bottom: 40, left: 32, right: 32 }}
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
