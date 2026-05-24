/**
 * AuthHeader — Brand lockup for auth screens.
 */
import React from 'react';
import { View, Text, Image } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

import { spacing, typography } from '@/constants/designTokens';
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
      style={{ alignItems: 'center', marginBottom: spacing[10] }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          overflow: 'hidden',
          marginBottom: spacing[3],
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
          fontFamily: 'DMSerifDisplay-Regular',
          fontSize: typography.display.size + 8,
          color: color.foreground,
          letterSpacing: -0.2,
        }}
      >
        Ekwe
      </Text>
      <Text
        style={{
          fontFamily: 'Outfit-Regular',
          fontSize: typography.body.size,
          color: color.muted,
          marginTop: spacing[2],
          textAlign: 'center',
        }}
      >
        {subtitle}
      </Text>
      {caption ? (
        <Text
          style={{
            fontFamily: 'Outfit-Regular',
            fontSize: typography.bodySmall.size,
            color: color.muted,
            marginTop: spacing[1],
            textAlign: 'center',
          }}
        >
          {caption}
        </Text>
      ) : null}
    </Animated.View>
  );
};
