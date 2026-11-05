import { Image as ExpoImage } from "expo-image";
import Crown from "lucide-react-native/icons/crown";
import Edit3 from "lucide-react-native/icons/pen-line";
import React from "react";

import { IconContainer } from "@/components/IconContainer";
import { Box, Pressable, Text } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import type { AuthUser } from "@/store/auth";
import { resolveUserAvatar, type AvatarIconItem } from "@/utils/avatar";
import { withAlpha } from "@/utils/color";
import { isIOS } from "@/utils";

export interface ProfileIdentityProps {
  user: AuthUser;
  isPro: boolean;
  currentIconData?: AvatarIconItem | null;
  userName: string;
  userEmail: string;
  rawName?: string;
  canEditAvatar?: boolean;
  onEditAvatar?: () => void;
}

export function ProfileIdentity({
  user,
  isPro,
  currentIconData,
  userName,
  userEmail,
  canEditAvatar = false,
  onEditAvatar,
}: ProfileIdentityProps): React.JSX.Element {
  const { color } = useTheme();

  // Deterministically resolve an avatar from the curated list for every user
  const avatar =
    currentIconData ??
    resolveUserAvatar(user?.avatarIcon, user?.id || user?.email);
  const IconComponent = avatar.icon;

  return (
    <Box
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.lg,
        marginBottom: spacing.xl,
        marginTop: spacing.sm,
      }}
    >
      <Box style={styles.avatarWrapper}>
        <IconContainer
          size={74}
          variant="custom"
          backgroundColor={withAlpha(avatar.color, 0.12)}
          style={{
            overflow: "hidden",
            boxShadow: isPro
              ? `0 4px 16px ${withAlpha(color.brand, 0.22)}`
              : shadows.softLg,
            borderWidth: isPro ? 2 : 1.5,
            borderColor: isPro ? color.brand : withAlpha(avatar.color, 0.35),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box
            style={{
              width: "100%",
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconComponent size={36} color={avatar.color} />
          </Box>
        </IconContainer>

        {canEditAvatar && onEditAvatar ? (
          <Pressable
            onPress={onEditAvatar}
            accessibilityRole="button"
            accessibilityLabel="Edit avatar"
            style={[
              styles.editButton,
              {
                backgroundColor: color.brand,
                borderColor: color.background,
              },
            ]}
            hitSlop={12}
          >
            {isIOS ? (
              <ExpoImage
                source="sf:pencil"
                style={{ width: 14, height: 14 }}
                tintColor={color.onBrand}
              />
            ) : (
              <Edit3 size={14} color={color.onBrand} />
            )}
          </Pressable>
        ) : null}
      </Box>

      <Box style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          variant="heading3"
          numberOfLines={1}
          style={{ color: color.foreground }}
        >
          {userName}
        </Text>

        <Box style={{ flexDirection: "row", alignItems: "center" }}>
          {isPro ? (
            <Box
              accessible
              accessibilityRole="text"
              accessibilityLabel="Paid account"
              style={[
                styles.planChip,
                {
                  backgroundColor: withAlpha(color.brand, 0.12),
                  borderColor: withAlpha(color.brand, 0.3),
                },
              ]}
            >
              <Crown size={12} color={color.brand} />
              <Text
                variant="label"
                style={{
                  color: color.brand,
                  fontWeight: "600",
                  textTransform: "uppercase",
                }}
              >
                Ekwe Paid
              </Text>
            </Box>
          ) : (
            <Box
              accessible
              accessibilityRole="text"
              accessibilityLabel="Free account"
              style={[
                styles.planChip,
                {
                  backgroundColor: withAlpha(color.foreground, 0.06),
                  borderColor: withAlpha(color.foreground, 0.14),
                },
              ]}
            >
              <Box
                style={[styles.statusDot, { backgroundColor: color.muted }]}
              />
              <Text
                variant="label"
                style={{
                  color: color.foreground,
                  fontWeight: "500",
                  textTransform: "uppercase",
                }}
              >
                Free Plan
              </Text>
            </Box>
          )}
        </Box>

        {userEmail ? (
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ color: color.muted }}
          >
            {userEmail}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

const styles = {
  avatarWrapper: {
    position: "relative",
  } as const,
  planChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  } as const,
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: borderRadius.full,
  } as const,
  editButton: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: iconSize.lg,
    height: iconSize.lg,
    borderRadius: borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
  } as const,
};
