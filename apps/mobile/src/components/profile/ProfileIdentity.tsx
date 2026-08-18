import { User } from "@supabase/supabase-js";
import { Image as ExpoImage } from "expo-image";
import Crown from "lucide-react-native/icons/crown";
import Lock from "lucide-react-native/icons/lock";
import Edit3 from "lucide-react-native/icons/pen-line";
import React from "react";
import { Image } from "react-native";

import { Badge } from "@/components/Badge";
import { Box, Text, Pressable } from "@/components/ui";
import { shadows, opacity } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import { isIOS } from "@/utils";

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
  avatarLocked?: boolean;
  onEditAvatar: () => void;
}

export function ProfileIdentity({
  user,
  isPro,
  currentIconData,
  userName,
  userEmail,
  rawName,
  avatarLocked = false,
  onEditAvatar,
}: ProfileIdentityProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Box
      style={{
        alignItems: "center",
        marginBottom: spacing.xl,
        marginTop: spacing.md,
      }}
    >
      <Box>
        <Box
          style={{
            width: 100,
            height: 100,
            borderRadius: borderRadius.full,
            borderWidth: 4,
            boxShadow: shadows.softLg,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderColor: color.card,
          }}
        >
          {currentIconData ? (
            <Box
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: withAlpha(currentIconData.color, 0.102),
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
              style={{ width: "100%", height: "100%", resizeMode: "cover" }}
            />
          ) : (
            <Box
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: withAlpha(color.brand, 0.102),
              }}
            >
              <Text
                variant="display"
                style={{
                  color: color.brand,
                }}
              >
                {rawName?.[0] || userName[0]?.toUpperCase() || "U"}
              </Text>
            </Box>
          )}
        </Box>
        <Pressable
          style={({ pressed }) => [
            {
              position: "absolute",
              bottom: -4,
              right: -4,
              width: iconSize.lg,
              height: iconSize.lg,
              borderRadius: borderRadius.xl,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 3,
              backgroundColor: color.brand,
              borderColor: color.background,
            },
            pressed && {
              opacity: opacity.inactive,
              transform: [{ scale: 0.92 }],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            avatarLocked
              ? "Avatar customization is a Pro feature"
              : "Edit avatar"
          }
          onPress={onEditAvatar}
        >
          {avatarLocked ? (
            isIOS ? (
              <ExpoImage
                source="sf:lock.fill"
                style={{ width: 14, height: 14 }}
                tintColor={color.onBrand}
              />
            ) : (
              <Lock size={14} color={color.onBrand} />
            )
          ) : isIOS ? (
            <ExpoImage
              source="sf:pencil"
              style={{ width: 14, height: 14 }}
              tintColor={color.onBrand}
            />
          ) : (
            <Edit3 size={14} color={color.onBrand} />
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
          label={isPro ? "Pro Member" : "Free Plan"}
          variant={isPro ? "warning" : "primary"}
          icon={
            isIOS ? (
              <ExpoImage
                source="sf:crown.fill"
                style={{ width: 14, height: 14 }}
                tintColor={isPro ? color.warning : color.brand}
              />
            ) : (
              <Crown size={14} color={isPro ? color.warning : color.brand} />
            )
          }
        />
      </Box>
    </Box>
  );
}
