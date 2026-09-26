import { Pencil } from "lucide-react-native";
import React from "react";
import { Pressable, TextInput, View } from "react-native";

import { Text } from "@/components/ui";
import { borderRadius, spacing } from "@/constants";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

import type { ReactElement } from "react";

export interface EditableTextProps {
  /** The committed text. Hidden while editing, but kept for the a11y value. */
  text: string;
  /** Draft contents, owned by the parent so Cancel is a plain state reset. */
  value: string;
  onChangeText: (next: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  isEditing: boolean;
  isApplying?: boolean;
  /**
   * Names the text being corrected, for the label and hint. "original words" vs
   * "message" is the difference a screen reader user needs to know *which* of
   * the two documents they are in.
   */
  accessibilityName: string;
  maxChars: number;
}

/**
 * The result's text, which becomes its editor in place.
 *
 * There is deliberately no modal and no separate screen: the words being
 * corrected are already the largest thing on the card, so moving them
 * elsewhere would be motion without purpose. The field borrows the chip
 * treatment (translucent fill over the brand card, hairline border) so it reads
 * as part of the card rather than a form dropped on top of it.
 *
 * The over-cap counter signals with weight rather than colour — `error` on
 * `brand` is roughly 1.5:1, which is not readable, so the state is carried by
 * the type ramp instead.
 */
function EditableTextComponent({
  text,
  value,
  onChangeText,
  onEdit,
  onCancel,
  isEditing,
  isApplying = false,
  accessibilityName,
  maxChars,
}: EditableTextProps): ReactElement {
  const { color } = useTheme();
  const onBrand = color.onBrand;
  const trimmed = value.trim();
  const canApply = trimmed.length > 0 && !isApplying;

  if (!isEditing) {
    return (
      <View>
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit the ${accessibilityName}. ${text}`}
          style={({ pressed }) => [
            { paddingVertical: spacing.xs },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.sm,
            }}
          >
            <Text
              variant="heading2"
              style={{ color: onBrand, flex: 1 }}
              numberOfLines={4}
            >
              {text}
            </Text>
            <Pencil size={14} color={withAlpha(onBrand, 0.6)} strokeWidth={2} />
          </View>
        </Pressable>
        <View style={{ height: spacing.sm }} />
      </View>
    );
  }

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
        }}
      >
        <Text
          variant="label"
          style={{ color: withAlpha(onBrand, 0.85) }}
          onPress={onCancel}
          suppressHighlighting
        >
          Cancel
        </Text>
      </View>

      <View
        style={{
          borderRadius: borderRadius.xl,
          borderWidth: 1,
          borderColor: withAlpha(onBrand, 0.35),
          backgroundColor: withAlpha(onBrand, 0.12),
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        <TextInput
          accessibilityLabel={`Edit the ${accessibilityName}`}
          accessibilityHint={`Correct the ${accessibilityName}, then convert to hear them.`}
          style={{
            color: onBrand,
            fontSize: 18,
            lineHeight: 27,
            minHeight: 54,
            textAlignVertical: "top",
          }}
          value={value}
          onChangeText={onChangeText}
          multiline
          maxLength={maxChars}
          selectionColor={onBrand}
          placeholderTextColor={withAlpha(onBrand, 0.6)}
          editable={!isApplying}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: spacing.xs,
        }}
      >
        <Text
          variant="caption"
          style={{
            // Weight carries the over-cap state; see the note above.
            color: withAlpha(onBrand, 0.7),
            fontFamily: value.length >= maxChars ? "Outfit-Medium" : undefined,
          }}
          accessibilityLiveRegion="polite"
        >
          {value.length}/{maxChars}
        </Text>
        <Text variant="caption" style={{ color: withAlpha(onBrand, 0.6) }}>
          {canApply
            ? `Convert re-renders the ${accessibilityName} in your voice`
            : "Type something to convert"}
        </Text>
      </View>
    </View>
  );
}

export const EditableText = React.memo(EditableTextComponent);
