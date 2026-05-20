import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { UserCircle } from 'lucide-react-native';
import React, { useCallback, useMemo } from 'react';
import { Image, Text, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks';
import { auth$ } from '@/store';

export const AccountAvatar = React.memo((): React.JSX.Element => {
  const user = useSelector(() => auth$.user.get());
  const router = useRouter();
  const { color } = useTheme();
  const primaryColor = color.primary;

  const handlePress = useCallback((): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/profile');
  }, [router]);

  const fullName =
    user?.user_metadata?.full_name || user?.user_metadata?.firstName || '';
  const initials = useMemo(
    () =>
      fullName
        ? fullName
            .split(' ')
            .map((n: string) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : null,
    [fullName],
  );
  const imageUrl =
    user?.user_metadata?.avatar_url || user?.user_metadata?.image_url;

  const containerStyle = useMemo(
    () => [
      styles.container,
      { backgroundColor: color.card, borderColor: color.border },
    ],
    [color.card, color.border],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={fullName ? `${fullName} profile` : 'Profile'}
    >
      {imageUrl ? (
        <ExpoImage
          source={{ uri: imageUrl }}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
      ) : initials ? (
        <Text style={[styles.initialsText, { color: primaryColor }]}>
          {initials}
        </Text>
      ) : process.env.EXPO_OS === 'ios' ? (
        <ExpoImage
          source="sf:person.circle"
          style={styles.sfIcon}
          tintColor={primaryColor}
        />
      ) : (
        <UserCircle size={24} color={primaryColor} strokeWidth={2} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  sfIcon: { width: 24, height: 24 },
  initialsText: { fontFamily: 'Outfit-Medium', fontSize: 14 },
});
