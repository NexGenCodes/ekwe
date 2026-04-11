import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';

import { getColor } from '@/constants/colors';

export default function SignInScreen() {
  const {
    signIn,
    setActive: setSignInActive,
    isLoaded: isSignInLoaded,
  } = useSignIn();
  const {
    signUp,
    setActive: setSignUpActive,
    isLoaded: isSignUpLoaded,
  } = useSignUp();
  const [emailAddress, setEmailAddress] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Attempt to sign in or sign up
  const onSignInPress = async () => {
    if (!isSignInLoaded || !isSignUpLoaded) return;

    setIsLoading(true);
    setError('');

    try {
      // First try to sign in
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
      });

      if (signInAttempt.status === 'needs_first_factor') {
        const emailFactor = (signInAttempt.supportedFirstFactors || []).find(
          (f) => f.strategy === 'email_code',
        );
        const prepareFactor = await signInAttempt.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: (emailFactor as any)?.emailAddressId || '',
        });
        setPendingVerification(true);
      } else if (signInAttempt.status === 'complete') {
        await setSignInActive({ session: signInAttempt.createdSessionId });
      }
    } catch (err: any) {
      console.log('SignIn error:', err);
      // If user doesn't exist, try to sign up
      if (err.errors?.[0]?.code === 'form_identifier_not_found') {
        try {
          await signUp.create({
            emailAddress,
          });

          await signUp.prepareEmailAddressVerification({
            strategy: 'email_code',
          });
          setPendingVerification(true);
        } catch (signUpErr: any) {
          setError(
            signUpErr.errors?.[0]?.message ||
              'An error occurred during sign up.',
          );
        }
      } else {
        setError(
          err.errors?.[0]?.message || 'An error occurred during sign in.',
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onPressVerify = async () => {
    if (!isSignInLoaded || !isSignUpLoaded) return;

    setIsLoading(true);
    setError('');

    try {
      // Check if we are verifying a sign in or sign up
      if (signIn.status === 'needs_first_factor') {
        const signInAttempt = await signIn.attemptFirstFactor({
          strategy: 'email_code',
          code,
        });

        if (signInAttempt.status === 'complete') {
          await setSignInActive({ session: signInAttempt.createdSessionId });
        } else {
          console.error('Sign in missing requirements', signInAttempt);
          setError('Missing requirements to complete sign in.');
        }
      } else if (signUp.status === 'missing_requirements') {
        const signUpAttempt = await signUp.attemptEmailAddressVerification({
          code,
        });

        if (signUpAttempt.status === 'complete') {
          await setSignUpActive({ session: signUpAttempt.createdSessionId });
        } else {
          console.error('Sign up missing requirements', signUpAttempt);
          setError('Missing requirements to complete sign up.');
        }
      }
    } catch (err: any) {
      console.error('Verification error', err);
      setError(err.errors?.[0]?.message || 'Invalid verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: getColor('background', isDark) }}
    >
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text
          style={{
            fontFamily: 'Outfit-Bold',
            fontSize: 28,
            color: getColor('foreground', isDark),
            marginBottom: 8,
          }}
        >
          Sign in to Ekwe
        </Text>
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: 16,
            color: getColor('muted', isDark),
            marginBottom: 32,
          }}
        >
          {pendingVerification
            ? 'Enter the code sent to your email.'
            : 'Enter your email address to continue.'}
        </Text>

        {error ? (
          <View
            style={{
              backgroundColor: 'rgba(255, 0, 0, 0.1)',
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: 'red', fontFamily: 'Outfit-Medium' }}>
              {error}
            </Text>
          </View>
        ) : null}

        {!pendingVerification ? (
          <>
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  fontFamily: 'Outfit-Medium',
                  color: getColor('foreground', isDark),
                  marginBottom: 8,
                }}
              >
                Email Address
              </Text>
              <TextInput
                autoCapitalize="none"
                value={emailAddress}
                placeholder="hello@ekwe.app"
                placeholderTextColor={getColor('muted', isDark)}
                onChangeText={(text) => {
                  setEmailAddress(text);
                  setError('');
                }}
                style={{
                  backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                  borderRadius: 12,
                  padding: 16,
                  color: getColor('foreground', isDark),
                  fontFamily: 'Outfit-Regular',
                  fontSize: 16,
                }}
                keyboardType="email-address"
              />
            </View>

            <TouchableOpacity
              onPress={onSignInPress}
              disabled={isLoading || !emailAddress}
              style={{
                backgroundColor: getColor('primary', isDark),
                borderRadius: 12,
                padding: 16,
                alignItems: 'center',
                opacity: isLoading || !emailAddress ? 0.7 : 1,
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
                  Continue with Email
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  fontFamily: 'Outfit-Medium',
                  color: getColor('foreground', isDark),
                  marginBottom: 8,
                }}
              >
                Verification Code
              </Text>
              <TextInput
                value={code}
                placeholder="123456"
                placeholderTextColor={getColor('muted', isDark)}
                onChangeText={(text) => {
                  setCode(text);
                  setError('');
                }}
                style={{
                  backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
                  borderRadius: 12,
                  padding: 16,
                  color: getColor('foreground', isDark),
                  fontFamily: 'Outfit-Regular',
                  fontSize: 16,
                }}
                keyboardType="number-pad"
              />
            </View>

            <TouchableOpacity
              onPress={onPressVerify}
              disabled={isLoading || !code}
              style={{
                backgroundColor: getColor('primary', isDark),
                borderRadius: 12,
                padding: 16,
                alignItems: 'center',
                opacity: isLoading || !code ? 0.7 : 1,
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
                  Verify Email
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setPendingVerification(false);
                setError('');
              }}
              style={{ marginTop: 16, alignItems: 'center' }}
            >
              <Text
                style={{
                  color: getColor('primary', isDark),
                  fontFamily: 'Outfit-Medium',
                }}
              >
                Use a different email
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
