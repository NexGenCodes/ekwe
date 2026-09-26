import { triggerHaptic } from "@/utils/haptics";
import { AnalyticsEvents, track } from "@/utils/analytics";
import Copy from "lucide-react-native/icons/copy";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import React, { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Pressable, Box } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { CopyService } from "@/services/copyOutService";

interface Props {
  textToCopy: string;
  style?: StyleProp<ViewStyle>;
  color?: string;
  size?: number;
  children?: React.ReactNode;
  accessibilityLabel?: string;

  copied?: boolean;
}

export const AnimatedCopyButton: React.FC<Props> = ({
  textToCopy,
  style,
  color: iconColorProp,
  size = 20,
  children,
  accessibilityLabel,
  copied = false,
}) => {
  const { color } = useTheme();
  const [copiedByPress, setCopiedByPress] = useState(false);

  const isCopied = copied || copiedByPress;

  const iconColor = iconColorProp || color.muted;
  const successColor = color.success;

  const handleCopy = async (): Promise<void> => {
    if (copiedByPress || !textToCopy) return;

    triggerHaptic("selection");
    const copied = await CopyService.copyText(textToCopy);
    if (!copied) return;
    track(AnalyticsEvents.RESULT_COPIED, { chars: textToCopy.length });
    setCopiedByPress(true);

    setTimeout(() => {
      setCopiedByPress(false);
    }, 3000);
  };

  return (
    <Pressable
      onPress={handleCopy}
      hitSlop={12}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? "Copy text"}
      accessibilityState={isCopied ? { selected: true } : undefined}
    >
      <Box
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
      >
        {isCopied ? (
          <CheckCircle2 color={successColor} size={size} strokeWidth={2.5} />
        ) : (
          <Copy color={iconColor} size={size} strokeWidth={2} />
        )}
        {children}
      </Box>
    </Pressable>
  );
};
