import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Lock } from 'lucide-react-native';
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks';

export interface SettingsRowProps {
  label: string;
  value: React.ReactNode;
  onPress?: () => void;
  isLocked?: boolean;
}

export const SettingsRow = ({
  label,
  value,
  onPress,
  isLocked = false,
}: SettingsRowProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Pressable
      onPress={() => {
        if (isLocked) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={!onPress && !isLocked}
      accessibilityRole="button"
      accessibilityLabel={isLocked ? `${label}. Locked. Upgrade required.` : label}
      accessibilityState={isLocked ? { disabled: true } : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: color.card,
          borderBottomColor: color.border,
          opacity: isLocked ? 0.5 : pressed && onPress && !isLocked ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.leftContent}>
        <Text style={[styles.label, { color: color.foreground }]}>{label}</Text>
        {isLocked &&
          (process.env.EXPO_OS === 'ios' ? (
            <ExpoImage
              source="sf:lock.fill"
              style={{ width: 14, height: 14 }}
              tintColor={color.muted}
            />
          ) : (
            <Lock size={14} color={color.muted} />
          ))}
      </View>
      {value}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  leftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: 'Outfit-Medium',
    fontSize: 15,
  },
});
