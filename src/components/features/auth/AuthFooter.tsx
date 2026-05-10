/**
 * AuthFooter — ToS + account toggle link.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

interface AuthFooterProps {
  text: string;
  linkText: string;
  onPress: () => void;
  showTos?: boolean;
}

export const AuthFooter = ({
  text,
  linkText,
  onPress,
  showTos = true,
}: AuthFooterProps): React.ReactElement => {
  const { color } = useTheme();
  const primaryColor = color.primary;
  const mutedColor = color.muted;

  return (
    <>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 4,
          marginTop: 24,
        }}
      >
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: 14,
            color: mutedColor,
          }}
        >
          {text}
        </Text>
        <Text
          style={{
            fontFamily: 'Outfit-Medium',
            fontSize: 14,
            color: primaryColor,
          }}
        >
          {linkText}
        </Text>
      </Pressable>

      {showTos ? (
        <Animated.View
          layout={Layout.springify()}
          entering={FadeInDown.duration(600).delay(200).springify()}
          style={{ marginTop: 40, paddingBottom: 24 }}
        >
          <Text
            style={{
              fontFamily: 'Outfit-Regular',
              fontSize: 12,
              color: mutedColor,
              textAlign: 'center',
              lineHeight: 18,
            }}
          >
            By continuing, you agree to our{'\n'}
            <Text style={{ color: primaryColor, fontFamily: 'Outfit-Medium' }}>
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text style={{ color: primaryColor, fontFamily: 'Outfit-Medium' }}>
              Privacy Policy
            </Text>
            .
          </Text>
        </Animated.View>
      ) : null}
    </>
  );
};
