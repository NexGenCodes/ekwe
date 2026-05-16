import * as Haptics from 'expo-haptics';
import { Lock } from 'lucide-react-native';
import React from 'react';
import { Pressable, View, Text } from 'react-native';

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
          // Show upgrade modal logic here in future
          return;
        }
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={!onPress && !isLocked}
      className={`flex-row items-center justify-between px-5 py-4 border-b bg-card dark:bg-card border-border dark:border-zinc-800/60 ${
        onPress && !isLocked
          ? 'active:opacity-70 transition-opacity duration-200'
          : ''
      }`}
      style={{ opacity: isLocked ? 0.5 : 1 }}
    >
      <View className="flex-row items-center gap-2">
        <Text className="font-bodyMed text-[15px] text-foreground dark:text-zinc-100">
          {label}
        </Text>
        {isLocked && <Lock size={14} color={color.muted} />}
      </View>
      {value}
    </Pressable>
  );
};
