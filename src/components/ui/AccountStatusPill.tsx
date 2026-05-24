import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

import { borderRadius, spacing } from '@/constants/designTokens';
import { useTheme } from '@/hooks';
import { auth$ } from '@/store';

export function AccountStatusPill(): React.ReactElement {
  const { color } = useTheme();
  const router = useRouter();
  const isPro = useSelector(() => auth$.isPro.get());

  if (isPro) {
    return (
      <View style={[styles.pill, styles.proBadge]}>
        <Text style={styles.proText}>PRO</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push('/billing');
      }}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: color.primary,
          borderColor: color.primary,
        },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Upgrade to Pro"
    >
      <Text style={[styles.upgradeText, { color: color.onPrimary }]}>
        Go Pro
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  proBadge: {
    borderColor: '#D4AF37',
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
  },
  proText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 13,
    color: '#D4AF37',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  upgradeText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
