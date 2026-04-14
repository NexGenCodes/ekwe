import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { UserCircle } from 'lucide-react-native';
import React from 'react';
import { Image, Text, Pressable } from 'react-native';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/store/authStore';

export const AccountAvatar = (): React.JSX.Element => {
  const { user } = useAuthStore();
  const router = useRouter();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  const handlePress = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/profile');
  };

  const fullName =
    user?.user_metadata?.full_name || user?.user_metadata?.firstName || '';
  const initials = fullName
    ? fullName
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : null;
  const imageUrl =
    user?.user_metadata?.avatar_url || user?.user_metadata?.image_url;

  return (
    <Pressable
      onPress={handlePress}
      className="w-10 h-10 rounded-full items-center justify-center bg-card dark:bg-card-dark border border-border dark:border-zinc-800 active:scale-95 transition-transform overflow-hidden"
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          className="w-full h-full"
          resizeMode="cover"
        />
      ) : initials ? (
        <Text className="font-bodyMed text-sm text-primary dark:text-primary-dark">
          {initials}
        </Text>
      ) : (
        <UserCircle size={24} color={primaryColor} strokeWidth={2} />
      )}
    </Pressable>
  );
};
