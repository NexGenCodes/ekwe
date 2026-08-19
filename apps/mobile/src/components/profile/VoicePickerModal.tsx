import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import Venus from "lucide-react-native/icons/venus";
import Mars from "lucide-react-native/icons/mars";
import type { LucideIcon } from "lucide-react-native";
import React from "react";
import { Modal, ScrollView } from "react-native";

import { Box, Text, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { type TtsVoice } from "@/store/settings";
import { withAlpha } from "@/utils/color";

interface VoicePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (value: TtsVoice) => void;
  currentVoice: TtsVoice;
}

const VOICE_OPTIONS: {
  value: TtsVoice;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "female", label: "Female", icon: Venus },
  { value: "male", label: "Male", icon: Mars },
];

export function VoicePickerModal({
  visible,
  onClose,
  onSelect,
  currentVoice,
}: VoicePickerModalProps): React.JSX.Element {
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
            maxHeight: "60%",
            borderTopWidth: 1,
            backgroundColor: color.background,
            borderColor: color.border,
          }}
        >
          {/* Header */}
          <Box
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderColor: color.border,
            }}
          >
            <Text
              variant="heading3"
              style={{
                color: color.foreground,
              }}
            >
              Select TTS Voice
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityLabel="Close voice picker"
            >
              <X size={24} color={color.muted} />
            </Pressable>
          </Box>

          {/* List */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
            }}
          >
            {VOICE_OPTIONS.map((item) => {
              const isSelected = currentVoice === item.value;
              return (
                <Pressable
                  key={item.value}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: spacing.md,
                      paddingHorizontal: spacing.sm,
                      borderRadius: borderRadius.lg,
                      marginVertical: spacing.hairline,
                    },
                    pressed && {
                      backgroundColor: withAlpha(color.foreground, 0.102),
                    },
                    isSelected && {
                      backgroundColor: withAlpha(color.foreground, 0.051),
                    },
                  ]}
                  onPress={() => onSelect(item.value)}
                  accessibilityLabel={`Select ${item.label} voice`}
                  accessibilityState={
                    isSelected ? { selected: true } : undefined
                  }
                >
                  <Box style={{ marginRight: spacing.md }}>
                    <item.icon
                      size={20}
                      color={color.foreground}
                      strokeWidth={2}
                    />
                  </Box>
                  <Box style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      style={{
                        color: color.foreground,
                        fontWeight: isSelected ? "600" : "400",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Box>
                  {isSelected && <Check size={20} color={color.foreground} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Box>
      </Box>
    </Modal>
  );
}