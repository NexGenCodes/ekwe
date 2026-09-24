import React, { useCallback } from "react";
import { Modal, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";

import { LanguageRow } from "@/components/language";
import { Box, Pressable, Text, ScrollArea } from "@/components/ui";
import { shadows } from "@/constants";
import { useTokens } from "@/hooks/ui";

export interface LanguageDropdownProps {
  visible: boolean;
  onClose: () => void;
  options: readonly string[];
  currentLang: string;
  onSelect: (code: string) => void;
  animatedStyle?: AnimatedStyle<ViewStyle>;
  gatedOptions?: ReadonlySet<string>;

  onPressGated?: (code: string) => void;
}

interface DropdownRowProps {
  code: string;
  isSelected: boolean;
  isGated: boolean;
  onSelect: (code: string) => void;
  onPressGated?: (code: string) => void;
}

const DropdownRow = React.memo(function DropdownRow({
  code,
  isSelected,
  isGated,
  onSelect,
  onPressGated,
}: DropdownRowProps): React.ReactElement {
  const handlePress = useCallback((): void => {
    if (isGated) {
      onPressGated?.(code);
      return;
    }
    onSelect(code);
  }, [onSelect, onPressGated, code, isGated]);
  return (
    <LanguageRow
      code={code}
      isSelected={isSelected}
      showLock={isGated}
      onPress={handlePress}
    />
  );
});
DropdownRow.displayName = "DropdownRow";

export function LanguageDropdown({
  visible,
  onClose,
  options,
  currentLang,
  onSelect,
  animatedStyle,
  gatedOptions,
  onPressGated,
}: LanguageDropdownProps): React.ReactElement {
  const { color, spacing, borderRadius } = useTokens();

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
          accessible={false}
          importantForAccessibility="no-hide-descendants"
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
            accessibilityViewIsModal
            style={[
              {
                width: "100%",
                maxWidth: 400,
                maxHeight: "60%",
                borderRadius: borderRadius["2xl"],
                borderWidth: 1,
                padding: spacing.xs,
                overflow: "hidden",
                boxShadow: shadows.softLg,
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
              {visible
                ? options.map((code) => (
                    <DropdownRow
                      key={code}
                      code={code}
                      isSelected={currentLang === code}
                      isGated={gatedOptions?.has(code) ?? false}
                      onSelect={onSelect}
                      onPressGated={onPressGated}
                    />
                  ))
                : null}
            </ScrollArea>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
