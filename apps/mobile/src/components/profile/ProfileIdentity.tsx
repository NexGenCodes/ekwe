import { Image as ExpoImage } from "expo-image";
import Lock from "lucide-react-native/icons/lock";
import Edit3 from "lucide-react-native/icons/pen-line";
import Crown from "lucide-react-native/icons/crown";
import React from "react";

import { LockedPressable } from "@/components/LockedPressable";
import { IconContainer } from "@/components/IconContainer";
import { Box, Text } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import type { AuthUser } from "@/store/auth";
import { withAlpha } from "@/utils/color";
import { isIOS } from "@/utils";

interface AvatarIconData {
  icon: React.ComponentType<{ color: string; size: number }>;
  color: string;
}

interface ProfileIdentityProps {
  user: AuthUser;
  isPro: boolean;
  currentIconData: AvatarIconData | null;
  userName: string;
  userEmail: string;
  rawName: string;
  // Controls whether the avatar edit button is interactive
  // false = locked (Free users), true = unlocked (Pro users)
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
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.lg,
        marginBottom: spacing["2xl"],
        marginTop: spacing.sm,
      }}
    >
      <Box style={styles.avatarWrapper}>
        <IconContainer
          size={72}
          variant={isPro ? "custom" : "primary"}
          backgroundColor={
            isPro
              ? withAlpha(color.brand, 0.15)
              : withAlpha(color.foreground, 0.08)
          }
          style={{
            overflow: "hidden",
            boxShadow: isPro
              ? `0 4px 16px ${withAlpha(color.brand, 0.18)}`
              : shadows.softLg,
            borderWidth: isPro ? 2 : 0,
            borderColor: isPro ? color.brand : undefined,
          }}
        >
          {currentIconData ? (
            <Box
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: withAlpha(currentIconData.color, 0.12),
              }}
            >
              {React.createElement(currentIconData.icon, {
                size: 36,
                color: currentIconData.color,
              })}
            </Box>
          ) : user?.avatarUrl ? (
            <ExpoImage
              source={{ uri: user.avatarUrl }}
              contentFit="cover"
              transition={300}
              cachePolicy="memory-disk"
              style={{ width: "100%", height: "100%", borderRadius: 36 }}
            />
          ) : (
            <Box
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isPro
                  ? withAlpha(color.brand, 0.12)
                  : withAlpha(color.foreground, 0.08),
              }}
            >
              <Text
                variant="display"
                style={{
                  color: isPro ? color.brand : color.foreground,
                }}
              >
                {rawName?.charAt(0) || userName.charAt(0).toUpperCase() || "U"}
              </Text>
            </Box>
          )}
        </IconContainer>
        <LockedPressable
          locked={avatarLocked}
          navigateToBilling
          onPress={onEditAvatar}
          accessibilityLabel={
            avatarLocked
              ? "Avatar customization is a paid feature"
              : "Edit avatar"
          }
          style={[
            styles.editButton,
            {
              backgroundColor: isPro ? color.brand : color.foreground,
              borderColor: color.background,
            },
          ]}
          hitSlop={12}
        >
          {isIOS ? (
            <ExpoImage
              source={avatarLocked ? "sf:lock.fill" : "sf:pencil"}
              style={{ width: 14, height: 14 }}
              tintColor={isPro ? color.onBrand : color.background}
            />
          ) : avatarLocked ? (
            <Lock size={14} color={isPro ? color.onBrand : color.background} />
          ) : (
            <Edit3 size={14} color={isPro ? color.onBrand : color.background} />
          )}
        </LockedPressable>
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="heading3"
          numberOfLines={1}
          style={{ color: color.foreground }}
        >
          {userName}
        </Text>
        {isPro ? (
          <Box
            accessible
            accessibilityRole="text"
            accessibilityLabel="Paid account"
            style={[
              styles.planChip,
              {
                backgroundColor: withAlpha(color.brand, 0.1),
                borderColor: withAlpha(color.brand, 0.28),
              },
            ]}
          >
            <Crown size={12} color={color.brand} />
            <Text
              variant="label"
              style={{
                color: color.brand,
                textTransform: "uppercase",
              }}
            >
              Paid
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
                backgroundColor: withAlpha(color.foreground, 0.05),
                borderColor: withAlpha(color.foreground, 0.1),
              },
            ]}
          >
            <Box style={[styles.statusDot, { backgroundColor: color.muted }]} />
            <Text
              variant="label"
              style={{
                color: color.muted,
                textTransform: "uppercase",
              }}
            >
              Free
            </Text>
          </Box>
        )}
        {userEmail && (
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ marginTop: spacing.xs, color: color.muted }}
          >
            {userEmail}
          </Text>
        )}
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
    gap: 5,
    alignSelf: "flex-start",
    marginTop: spacing.xs,
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
