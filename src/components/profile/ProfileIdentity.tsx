import { User } from '@supabase/supabase-js';
import { Image as ExpoImage } from 'expo-image';
import { Crown, Edit3 } from 'lucide-react-native';
import React from 'react';
import { Image } from 'react-native';

import { Badge } from '@/components/Badge';
import { Box, Text, Pressable } from '@/components/ui';
import { shadows } from '@/constants';
import { borderRadius, iconSize } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme } from '@/hooks';
import { isIOS } from '@/utils';

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
    <Box
      style={{ alignItems: 'center', marginBottom: 32, marginTop: spacing.md }}
    >
      <Box>
        <Box
          style={{
            width: 100,
            height: 100,
            borderRadius: borderRadius.full,
            borderWidth: 4,
            ...shadows.softLg,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderColor: color.card,
          }}
        >
          {currentIconData ? (
            <Box
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${currentIconData.color}1A`,
              }}
            >
              {React.createElement(currentIconData.icon, {
                size: 48,
                color: currentIconData.color,
              })}
            </Box>
          ) : user?.user_metadata?.avatar_url ? (
            <Image
              source={{ uri: user.user_metadata.avatar_url }}
              style={{ width: '100%', height: '100%', resizeMode: 'cover' }}
            />
          ) : (
            <Box
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${color.secondary}1A`,
              }}
            >
              <Text
                variant="display"
                style={{
                  color: color.secondary,
                }}
              >
                {rawName?.[0] || userName[0]?.toUpperCase() || 'U'}
              </Text>
            </Box>
          )}
        </Box>
        <Pressable
          style={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            width: iconSize.lg,
            height: iconSize.lg,
            borderRadius: borderRadius.xl,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 3,
            backgroundColor: color.secondary,
            borderColor: color.background,
          }}
          onPress={onEditAvatar}
        >
          {isIOS ? (
            <ExpoImage
              source="sf:pencil"
              style={{ width: 14, height: 14 }}
              tintColor={color.onSecondary}
            />
          ) : (
            <Edit3 size={14} color={color.onSecondary} />
          )}
        </Pressable>
      </Box>
      <Text
        variant="heading2"
        style={{
          marginTop: spacing.md,
          color: color.foreground,
        }}
      >
        {userName}
      </Text>
      {userEmail && (
        <Text
          variant="bodySmall"
          style={{ marginTop: spacing.xs, color: color.muted }}
        >
          {userEmail}
        </Text>
      )}
      <Box style={{ marginTop: spacing.md }}>
        <Badge
          label={isPro ? 'Pro Member' : 'Basic Plan'}
          variant={isPro ? 'warning' : 'primary'}
          icon={
            isIOS ? (
              <ExpoImage
                source="sf:crown.fill"
                style={{ width: 14, height: 14 }}
                tintColor={isPro ? color.warning : color.secondary}
              />
            ) : (
              <Crown
                size={14}
                color={isPro ? color.warning : color.secondary}
              />
            )
          }
        />
      </Box>
    </Box>
  );
}
