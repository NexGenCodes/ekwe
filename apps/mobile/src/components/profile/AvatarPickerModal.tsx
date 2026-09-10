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
import X from "lucide-react-native/icons/x";
import React from "react";
import { Modal } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

// Cosmetic swatch colors for the avatar picker. Purely decorative — not part
// of the design-token system, so they live with the component.
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
  const { color } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Box
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: color.overlay,
        }}
      >
        <Box
          style={{
            borderTopLeftRadius: borderRadius["2xl"],
            borderTopRightRadius: borderRadius["2xl"],
            padding: spacing.lg,
            paddingBottom: spacing["3xl"],
            borderTopWidth: 1,
            backgroundColor: color.background,
            borderColor: color.border,
          }}
        >
          <Box
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: spacing.lg,
            }}
          >
            <Text
              variant="heading3"
              style={{
                color: color.foreground,
              }}
            >
              Choose an Avatar
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityLabel="Close avatar picker"
            >
              <X size={24} color={color.muted} />
            </Pressable>
          </Box>

          <Box
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.md,
              justifyContent: "center",
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
                      borderColor: isSelected ? item.color : color.border,
                    },
                    pressed && {
                      backgroundColor: `${item.color}1A`,
                      transform: [{ scale: 0.95 }],
                    },
                  ]}
                  onPress={() => onSelect(item.name)}
                  accessibilityLabel={`Select ${item.name} avatar`}
                  accessibilityState={
                    isSelected ? { selected: true } : undefined
                  }
                >
                  <item.icon size={32} color={item.color} />
                </Pressable>
              );
            })}

            {/* Default Option (Google / Initials) */}
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
                  borderColor: !currentIcon ? color.foreground : color.border,
                },
                pressed && {
                  backgroundColor: withAlpha(color.foreground, 0.102),
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
                  color: !currentIcon ? color.foreground : color.muted,
                  marginTop: spacing.xs,
                }}
              >
                Auto
              </Text>
            </Pressable>
          </Box>
        </Box>
      </Box>
    </Modal>
  );
}
