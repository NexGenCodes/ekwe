import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

export interface ProfileSectionProps {
  title: string;
  titleColor?: string;
  delay: number;
  children: React.ReactNode;
}

export function ProfileSection({
  title,
  titleColor,
  delay,
  children,
}: ProfileSectionProps): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(400)}
      style={styles.section}
    >
      <Text style={[styles.sectionTitle, { color: titleColor ?? color.muted }]}>
        {title}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: color.card, borderColor: color.border },
        ]}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 32 },
  sectionTitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 16,
  },
  card: { borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
});
