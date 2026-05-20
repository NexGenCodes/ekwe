import React from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

interface LensCardProps {
  transcript: string;
}

export function LensCard({ transcript }: LensCardProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={[
        styles.container,
        { backgroundColor: color.card, borderColor: color.border },
      ]}
    >
      <Text style={[styles.text, { color: color.foreground }]}>
        {transcript}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#09090b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 15,
  },
  text: { fontFamily: 'Outfit-Regular', fontSize: 16, lineHeight: 24 },
});
