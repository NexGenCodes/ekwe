import React from "react";
import { Modal, View, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { LanguageRow } from "@/components/language";
import { Box, Pressable, Text, ScrollArea } from "@/components/ui";
import { shadows } from "@/constants";
import { useTokens } from "@/hooks/ui";

export interface LanguageDropdownProps {
  visible: boolean;
  onClose: () => void;
  options: string[];
  currentLang: string;
  oppositeLang?: string;
  onSelect: (code: string) => void;
  animatedStyle?: object;
  gatedOptions?: Set<string>;
}

export function LanguageDropdown({
  visible,
  onClose,
  options,
  currentLang,
  oppositeLang,
  onSelect,
  animatedStyle,
  gatedOptions,
}: LanguageDropdownProps): React.ReactElement | null {
  const { color, spacing, borderRadius } = useTokens();

  if (!visible && !animatedStyle) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill}>
        <Pressable
          onPress={onClose}
          feedback="none"
          style={StyleSheet.absoluteFill}
        >
          <View style={{ flex: 1, backgroundColor: color.overlay }} />
        </Pressable>

        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: spacing.lg,
          }}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              {
                width: "100%",
                maxWidth: 400,
                maxHeight: "60%",
                borderRadius: borderRadius["2xl"],
                borderWidth: 1,
                padding: spacing.xs,
                overflow: "hidden",
                ...shadows.softLg,
                backgroundColor: color.card,
                borderColor: color.border,
              },
              animatedStyle,
            ]}
          >
            <Box
              style={{
                paddingHorizontal: spacing.md,
                paddingTop: spacing.md,
                paddingBottom: spacing.sm,
              }}
            >
              <Text
                variant="caption"
                style={{
                  textTransform: "uppercase",
                  color: color.muted,
                }}
              >
                Select Language
              </Text>
            </Box>

            <ScrollArea bounces={false}>
              {options.map((code) => {
                const isSelected = currentLang === code;
                const isOtherLang = code === oppositeLang && code !== "auto";

                return (
                  <LanguageRow
                    key={code}
                    code={code}
                    isSelected={isSelected}
                    disabled={isOtherLang || (gatedOptions?.has(code) ?? false)}
                    showLock={gatedOptions?.has(code) ?? false}
                    onPress={() => onSelect(code)}
                  />
                );
              })}
            </ScrollArea>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
