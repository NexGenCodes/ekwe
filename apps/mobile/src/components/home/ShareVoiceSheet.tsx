import ChevronRight from "lucide-react-native/icons/chevron-right";
import MessageCircle from "lucide-react-native/icons/message-circle";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import Share2 from "lucide-react-native/icons/share-2";
import React from "react";

import { IconContainer } from "@/components/IconContainer";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { Box, Pressable, Text } from "@/components/ui";
import {
  SHARE_TARGETS,
  SHARE_TARGET_BY_ID,
  type ShareTarget,
} from "@/constants/shareTargets";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

export interface ShareVoiceSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (target: ShareTarget) => void;
  onSelectSystem?: () => void;
  busyTarget?: ShareTarget | null;
}

function TargetRow({
  target,
  busy,
  onPress,
}: {
  target: ShareTarget;
  busy: boolean;
  onPress: (target: ShareTarget) => void;
}): React.ReactElement {
  const { color } = useTheme();
  const config = SHARE_TARGET_BY_ID[target];
  const accent = target === "whatsapp" ? "#25D366" : "#229ED9";
  const Icon = target === "whatsapp" ? MessageCircle : SendHorizontal;

  return (
    <Pressable
      onPress={() => onPress(target)}
      disabled={busy}
      accessibilityLabel={`${config.label}. ${config.badge}. ${config.description}`}
      accessibilityHint="Opens the selected app with your voice"
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: color.border,
          borderRadius: borderRadius.xl,
          backgroundColor: color.surface,
          minHeight: 72,
        },
        pressed && !busy ? { opacity: 0.82 } : {},
      ]}
    >
      <IconContainer
        size="lg"
        variant="custom"
        backgroundColor={withAlpha(accent, 0.14)}
      >
        <Icon size={iconSize.md} color={accent} />
      </IconContainer>

      <Box style={{ flex: 1, gap: 2 }}>
        <Box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="heading3" style={{ color: color.foreground }}>
            {config.label}
          </Text>
          <Box
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: borderRadius.full,
              backgroundColor: withAlpha(accent, 0.14),
            }}
          >
            <Text
              variant="label"
              style={{ color: accent, fontSize: 11, lineHeight: 16 }}
            >
              {config.badge}
            </Text>
          </Box>
        </Box>
        <Text variant="bodySmall" style={{ color: color.muted }}>
          {config.description}
        </Text>
      </Box>

      {busy ? (
        <Spinner size="sm" color={accent} />
      ) : (
        <ChevronRight size={iconSize.md} color={color.muted} />
      )}
    </Pressable>
  );
}

export function ShareVoiceSheet({
  visible,
  onClose,
  onSelect,
  onSelectSystem,
  busyTarget = null,
}: ShareVoiceSheetProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Send voice"
      maxHeight="65%"
    >
      <Box style={{ padding: spacing.lg, gap: spacing.sm }}>
        {SHARE_TARGETS.map((target) => (
          <TargetRow
            key={target.id}
            target={target.id}
            busy={busyTarget === target.id}
            onPress={onSelect}
          />
        ))}

        {onSelectSystem && (
          <Pressable
            onPress={onSelectSystem}
            accessibilityLabel="More share options. Opens system share sheet"
            accessibilityHint="Opens system share sheet to send voice via AirDrop, Messages, Files, or other apps"
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                padding: spacing.md,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: borderRadius.xl,
                backgroundColor: color.surface,
                minHeight: 72,
              },
              pressed ? { opacity: 0.82 } : {},
            ]}
          >
            <IconContainer
              size="lg"
              variant="custom"
              backgroundColor={withAlpha(color.brand, 0.14)}
            >
              <Share2 size={iconSize.md} color={color.brand} />
            </IconContainer>

            <Box style={{ flex: 1, gap: 2 }}>
              <Text variant="heading3" style={{ color: color.foreground }}>
                More options…
              </Text>
              <Text variant="bodySmall" style={{ color: color.muted }}>
                AirDrop, Messages, Files, and other apps
              </Text>
            </Box>

            <ChevronRight size={iconSize.md} color={color.muted} />
          </Pressable>
        )}
      </Box>

      <Box style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Text
          variant="bodySmall"
          style={{ color: color.muted, textAlign: "center" }}
        >
          WhatsApp sends shared audio as a file. Telegram sends it as a voice
          note.
        </Text>
      </Box>
    </Sheet>
  );
}
