import { Image as ExpoImage } from "expo-image";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import type { LucideIcon } from "lucide-react-native";
import React from "react";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

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
}: ProfileRowProps): React.JSX.Element {
  const { color } = useTheme();
  const bgTint = `${accentColor ?? iconColor}1A`;

  return (
    <Pressable
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
          borderBottomWidth: 0.5,
        },
        pressed && { backgroundColor: bgTint, transform: [{ scale: 0.98 }] },
      ]}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      <Box style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
        <Box
          style={{
            width: 44,
            height: 44,
            borderRadius: borderRadius["2xl"],
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bgTint,
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
      {trailing ??
        (isIOS ? (
          <ExpoImage
            source="sf:chevron.right"
            style={{ width: 14, height: 14, marginRight: spacing.xs }}
            tintColor={color.muted}
          />
        ) : (
          <ChevronRight size={20} color={color.muted} />
        ))}
    </Pressable>
  );
}
