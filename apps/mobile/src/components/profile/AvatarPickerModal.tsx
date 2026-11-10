import User from "lucide-react-native/icons/user";
import React from "react";

import { Box, Text, Pressable } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { AVATAR_ICONS } from "@/utils/avatar";
import { withAlpha } from "@/utils/color";

export { AVATAR_ICONS } from "@/utils/avatar";

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
            Default
          </Text>
        </Pressable>
      </Box>
    </Sheet>
  );
}
