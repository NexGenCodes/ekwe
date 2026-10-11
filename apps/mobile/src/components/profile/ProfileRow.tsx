import { Image as ExpoImage } from "expo-image";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import type { LucideIcon } from "lucide-react-native";
import React from "react";

import { LockedPressable } from "@/components/LockedPressable";
import { Box, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";
import { withAlpha } from "@/utils/color";

export interface ProfileRowProps {
  icon: LucideIcon;
  sfIcon?: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  hasDivider?: boolean;
  trailing?: React.ReactNode;
  accentColor?: string;
  locked?: boolean;

  navigateToBilling?: boolean;

  checked?: boolean;
}

export function ProfileRow({
  icon: Icon,
  sfIcon,
  iconColor,
  title,
  subtitle,
  onPress,
  hasDivider = false,
  trailing,
  accentColor,
  locked = false,
  navigateToBilling = false,
  checked,
}: ProfileRowProps): React.JSX.Element {
  const { color } = useTheme();

  const iconBg = withAlpha(accentColor ?? iconColor, 0.1);

  const pressBg = withAlpha(accentColor ?? iconColor, 0.15);

  return (
    <LockedPressable
      locked={locked}
      label={title}
      navigateToBilling={navigateToBilling}
      onPress={onPress}
      style={({ pressed }) => [
        {
          padding: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        hasDivider && {
          borderBottomColor: color.border,
          borderBottomWidth: 1,
        },
        pressed && { backgroundColor: pressBg, transform: [{ scale: 0.98 }] },
      ]}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ checked }}
      contentStyle={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      hitSlop={12}
    >
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          marginRight: spacing.sm,
        }}
      >
        <Box
          style={{
            width: 44,
            height: 44,
            borderRadius: borderRadius["2xl"],
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: iconBg,
          }}
        >
          {isIOS && sfIcon ? (
            <ExpoImage
              source={`sf:${sfIcon}`}
              style={{ width: 20, height: 20 }}
              tintColor={iconColor}
            />
          ) : (
            <Icon size={20} color={iconColor} />
          )}
        </Box>
        <Box style={{ marginLeft: spacing.md, flex: 1 }}>
          <Text
            variant="body"
            style={{
              color: iconColor === color.error ? color.error : color.foreground,
            }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              variant="bodySmall"
              style={{
                marginTop: spacing.xs,
                color: iconColor === color.error ? color.error : color.muted,
                opacity: iconColor === color.error ? 0.8 : 1,
              }}
            >
              {subtitle}
            </Text>
          )}
        </Box>
      </Box>
      {locked ? null : trailing ? (
        <Box style={{ flexShrink: 1 }}>{trailing}</Box>
      ) : isIOS ? (
        <ExpoImage
          source="sf:chevron.right"
          style={{ width: 14, height: 14, marginRight: spacing.xs }}
          tintColor={color.muted}
        />
      ) : (
        <ChevronRight size={20} color={color.muted} />
      )}
    </LockedPressable>
  );
}
