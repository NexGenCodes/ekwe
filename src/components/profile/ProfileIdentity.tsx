import { User } from '@supabase/supabase-js';
import { Image as ExpoImage } from 'expo-image';
import { Crown, Edit3 } from 'lucide-react-native';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

interface AvatarIconData {
  icon: React.ComponentType<{ color: string; size: number }>;
  color: string;
}

interface ProfileIdentityProps {
  user: User;
  isPro: boolean;
  currentIconData: AvatarIconData | null;
  userName: string;
  userEmail: string;
  rawName: string;
  onEditAvatar: () => void;
}

export function ProfileIdentity({
  user,
  isPro,
  currentIconData,
  userName,
  userEmail,
  rawName,
  onEditAvatar,
}: ProfileIdentityProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown.delay(100).duration(400)}
      style={styles.profileHeader}
    >
      <View>
        <View style={[styles.avatarContainer, { borderColor: color.card }]}>
          {currentIconData ? (
            <View
              style={[
                styles.avatarPlaceholder,
                { backgroundColor: `${currentIconData.color}1A` },
              ]}
            >
              {React.createElement(currentIconData.icon, {
                size: 48,
                color: currentIconData.color,
              })}
            </View>
          ) : user?.user_metadata?.avatar_url ? (
            <Image
              source={{ uri: user.user_metadata.avatar_url }}
              style={styles.avatarImage}
            />
          ) : (
            <View
              style={[
                styles.avatarPlaceholder,
                { backgroundColor: `${color.primary}1A` },
              ]}
            >
              <Text
                style={[styles.avatarPlaceholderText, { color: color.primary }]}
              >
                {rawName?.[0] || userName[0]?.toUpperCase() || 'U'}
              </Text>
            </View>
          )}
        </View>
        <Pressable
          style={[
            styles.editAvatarButton,
            {
              backgroundColor: color.primary,
              borderColor: color.background,
            },
          ]}
          onPress={onEditAvatar}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <ExpoImage
              source="sf:pencil"
              style={{ width: 14, height: 14 }}
              tintColor={color.onPrimary}
            />
          ) : (
            <Edit3 size={14} color={color.onPrimary} />
          )}
        </Pressable>
      </View>
      <Text style={[styles.userName, { color: color.foreground }]}>
        {userName}
      </Text>
      {userEmail && (
        <Text style={[styles.userEmail, { color: color.muted }]}>
          {userEmail}
        </Text>
      )}
      <View
        style={[
          styles.tierBadge,
          {
            backgroundColor: `${color.primary}1A`,
            borderColor: `${color.primary}33`,
          },
        ]}
      >
        {process.env.EXPO_OS === 'ios' ? (
          <ExpoImage
            source="sf:crown.fill"
            style={{ width: 14, height: 14 }}
            tintColor={color.primary}
          />
        ) : (
          <Crown size={14} color={color.primary} />
        )}
        <Text style={[styles.tierBadgeText, { color: color.primary }]}>
          {isPro ? 'Pro Member' : 'Free Plan'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  profileHeader: { alignItems: 'center', marginBottom: 32, marginTop: 12 },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: { fontFamily: 'Outfit-Medium', fontSize: 36 },
  avatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  editAvatarButton: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  userName: {
    fontFamily: 'Outfit-Medium',
    fontSize: 24,
    marginTop: 16,
    letterSpacing: -0.5,
  },
  userEmail: { fontFamily: 'Outfit-Regular', fontSize: 14, marginTop: 4 },
  tierBadge: {
    flexDirection: 'row',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: 'center',
  },
  tierBadgeText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 6,
  },
});
