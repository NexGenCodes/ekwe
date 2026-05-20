/**
 * AuthHeader — Brand lockup for auth screens.
 */
import React from 'react';
import { View, Text, Image } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const iconLight = require('../../assets/icon-light.png');
const iconDark = require('../../assets/icon.png');

interface AuthHeaderProps {
  subtitle: string;
  caption?: string;
}

export const AuthHeader = ({
  subtitle,
  caption,
}: AuthHeaderProps): React.ReactElement => {
  const { isDark, color } = useTheme();

  return (
    <Animated.View
      layout={Layout.springify()}
      entering={FadeInDown.duration(600).springify()}
      style={{ alignItems: 'center', marginBottom: 40 }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <Image
          source={isDark ? iconDark : iconLight}
          style={{ width: 64, height: 64 }}
          resizeMode="cover"
        />
      </View>
      <Text
        style={{
          fontFamily: 'Outfit-Medium', // font-display
          fontSize: 36,
          color: color.foreground,
          letterSpacing: -0.5,
        }}
      >
        Ekwe
      </Text>
      <Text
        style={{
          fontFamily: 'Outfit-Regular',
          fontSize: 16,
          color: color.muted,
          marginTop: 8,
          textAlign: 'center',
        }}
      >
        {subtitle}
      </Text>
      {caption ? (
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: 14,
            color: color.muted,
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {caption}
        </Text>
      ) : null}
    </Animated.View>
  );
};
