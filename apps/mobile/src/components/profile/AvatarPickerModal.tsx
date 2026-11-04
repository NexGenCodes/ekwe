import Smile from "lucide-react-native/icons/face-slightly-smiling";
import Ghost from "lucide-react-native/icons/ghost";
import Sparkles from "lucide-react-native/icons/sparkles";
import Heart from "lucide-react-native/icons/heart";
import Star from "lucide-react-native/icons/star";
import Zap from "lucide-react-native/icons/zap";
import Coffee from "lucide-react-native/icons/coffee";
import Music from "lucide-react-native/icons/music";
import Rocket from "lucide-react-native/icons/rocket";
import User from "lucide-react-native/icons/user";
import React from "react";

import { Box, Text, Pressable } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

const AVATAR_COLORS = {
  smile: "#F5A524",
  ghost: "#006FEE",
  sparkles: "#17C964",
  heart: "#F31260",
  star: "#FBBF24",
  zap: "#3B82F6",
  coffee: "#A1A1AA",
  music: "#F87171",
  rocket: "#4ADE80",
} as const;

export const AVATAR_ICONS = [
  { name: "Smile", icon: Smile, color: AVATAR_COLORS.smile },
  { name: "Ghost", icon: Ghost, color: AVATAR_COLORS.ghost },
  { name: "Sparkles", icon: Sparkles, color: AVATAR_COLORS.sparkles },
  { name: "Heart", icon: Heart, color: AVATAR_COLORS.heart },
  { name: "Star", icon: Star, color: AVATAR_COLORS.star },
  { name: "Zap", icon: Zap, color: AVATAR_COLORS.zap },
  { name: "Coffee", icon: Coffee, color: AVATAR_COLORS.coffee },
  { name: "Music", icon: Music, color: AVATAR_COLORS.music },
  { name: "Rocket", icon: Rocket, color: AVATAR_COLORS.rocket },
];

interface AvatarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  currentIcon?: string | null;
}

export function AvatarPickerModal({
  visible,
  onClose,
  onSelect,
  currentIcon,
}: AvatarPickerModalProps): React.JSX.Element {
  const { color, isDark } = useTheme();

  const getPressedBg = (itemColor: string): string =>
    isDark ? withAlpha(itemColor, 0.25) : `${itemColor}1A`;

  const getDefaultPressedBg = (): string =>
    isDark
      ? withAlpha(color.foreground, 0.15)
      : withAlpha(color.foreground, 0.102);

  const getBorderColor = (isSelected: boolean, itemColor: string): string =>
    isSelected ? itemColor : color.border;

  const getDefaultBorderColor = (hasIcon: boolean): string =>
    !hasIcon ? color.foreground : color.border;

  const getTextColor = (hasIcon: boolean): string =>
    !hasIcon ? color.foreground : color.muted;

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose an Avatar">
      <Box
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.md,
          justifyContent: "center",
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing["2xl"],
        }}
      >
        {AVATAR_ICONS.map((item) => {
          const isSelected = currentIcon === item.name;
          return (
            <Pressable
              key={item.name}
              style={({ pressed }) => [
                {
                  width: 72,
                  height: 72,
                  borderRadius: borderRadius["2xl"],
                  borderWidth: 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: color.card,
                  borderColor: getBorderColor(isSelected, item.color),
                },
                pressed && {
                  backgroundColor: getPressedBg(item.color),
                  transform: [{ scale: 0.95 }],
                },
              ]}
              onPress={() => onSelect(item.name)}
              accessibilityLabel={`Select ${item.name} avatar`}
              accessibilityState={isSelected ? { selected: true } : undefined}
            >
              <item.icon size={32} color={item.color} />
            </Pressable>
          );
        })}

        <Pressable
          style={({ pressed }) => [
            {
              width: 72,
              height: 72,
              borderRadius: borderRadius["2xl"],
              borderWidth: 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color.card,
              borderColor: getDefaultBorderColor(!!currentIcon),
            },
            pressed && {
              backgroundColor: getDefaultPressedBg(),
              transform: [{ scale: 0.95 }],
            },
          ]}
          onPress={() => onSelect("")}
          accessibilityLabel="Use default avatar"
          accessibilityState={!currentIcon ? { selected: true } : undefined}
        >
          <User size={32} color={color.foreground} />
          <Text
            variant="caption"
            style={{
              color: getTextColor(!!currentIcon),
              marginTop: spacing.xs,
            }}
          >
            Auto
          </Text>
        </Pressable>
      </Box>
    </Sheet>
  );
}
