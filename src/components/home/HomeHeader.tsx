import * as Haptics from 'expo-haptics';
import { Bell } from 'lucide-react-native';
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

import { EkweLogo } from '@/components/EkweLogo';
import { useTheme } from '@/hooks';
import { AppAlert } from '@/utils/alert';

export function HomeHeader(): React.ReactElement {
  const { color } = useTheme();

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.watermarkContainer}>
          <EkweLogo size={240} color={color.primary} opacity={0.05} />
        </View>
      </View>
      <View style={styles.leftGroup}>
        <View style={[styles.iconBox, { backgroundColor: color.primary }]}>
          <EkweLogo size={40} color={color.onPrimary} strokeWidth={2.5} />
        </View>
        <View>
          <Text style={[styles.title, { color: color.foreground }]}>Ekwe</Text>
          <Text style={[styles.subtitle, { color: color.muted }]}>
            Ready to translate.
          </Text>
        </View>
      </View>

      <Pressable
        onPress={async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          AppAlert.info('Notifications', 'You have no new notifications.');
        }}
        style={({ pressed }) => [
          styles.bellButton,
          { backgroundColor: color.card, borderColor: color.border },
          pressed && styles.bellButtonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
      >
        <Bell size={22} color={color.primary} />
        <View style={[styles.badgeDot, { backgroundColor: color.error }]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    paddingTop: 16,
    paddingBottom: 32,
    overflow: 'hidden',
  },
  watermarkContainer: {
    position: 'absolute',
    top: -40,
    right: -80,
    transform: [{ rotate: '15deg' }],
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Outfit-Bold',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
    marginTop: 2,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    position: 'relative',
  },
  bellButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  badgeDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
