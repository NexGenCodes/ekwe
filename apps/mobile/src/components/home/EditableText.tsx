import React from "react";
import { TextInput, View } from "react-native";

import { Text } from "@/components/ui";
import { borderRadius, spacing } from "@/constants";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

import type { ReactElement } from "react";

export type EditFieldKey = "transcript" | "translation";

export interface EditableField {
  key: EditFieldKey;
  /** Names the document on screen. */
  label: string;
  /** Spoken name. Defaults to `label`; set it when the visible text is not a name. */
  a11yLabel?: string;
  value: string;
}

export interface EditableTextProps {
  /** The committed text, shown collapsed. */
  text: string;
  /** One entry per document the user may correct. */
  fields: EditableField[];
  onChangeField: (key: EditFieldKey, next: string) => void;
  onCancel: () => void;
  isEditing: boolean;
  maxChars: number;
  /** What Convert will do, so a correction is never a surprise. */
  hint: string;
}

/** Read-only when collapsed; one labelled field per document when editing. */
function EditableTextComponent({
  text,
  fields,
  onChangeField,
  onCancel,
  isEditing,
  maxChars,
  hint,
}: EditableTextProps): ReactElement {
  const { color } = useTheme();
  const onBrand = color.onBrand;

  if (!isEditing) {
    return (
      <View style={{ paddingVertical: spacing.xs }}>
        <Text variant="heading2" style={{ color: onBrand }} numberOfLines={4}>
          {text}
        </Text>
      </View>
    );
  }

  // The spoken document is what gets rendered, so that is the one that gates
  // Convert.
  const primary = fields.find((f) => f.key === "translation") ?? fields[0];
  const canApply = (primary?.value.trim().length ?? 0) > 0;

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

      {fields.map((field, index) => {
        const over = field.value.length >= maxChars;
        return (
          <View key={field.key} style={{ marginBottom: spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: spacing.xs,
              }}
            >
              <Text
                variant="caption"
                style={{ color: withAlpha(onBrand, 0.7) }}
                numberOfLines={1}
              >
                {field.label}
              </Text>
              <Text
                variant="caption"
                style={{
                  color: withAlpha(onBrand, 0.7),
                  // `error` on `brand` is ~1.5:1, so weight carries this.
                  fontFamily: over ? "Outfit-Medium" : undefined,
                }}
                accessibilityLiveRegion="polite"
              >
                {field.value.length}/{maxChars}
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
                accessibilityLabel={`Edit the ${field.a11yLabel ?? field.label}`}
                style={{
                  color: onBrand,
                  fontSize: index === 0 ? 18 : 15,
                  lineHeight: index === 0 ? 27 : 21,
                  minHeight: index === 0 ? 54 : 40,
                  textAlignVertical: "top",
                }}
                value={field.value}
                onChangeText={(next) => onChangeField(field.key, next)}
                multiline
                maxLength={maxChars}
                selectionColor={onBrand}
                placeholderTextColor={withAlpha(onBrand, 0.6)}
              />
            </View>
          </View>
        );
      })}

      <Text
        variant="caption"
        style={{
          color: withAlpha(onBrand, 0.6),
          textAlign: "right",
        }}
      >
        {canApply ? hint : "Type something to convert"}
      </Text>
    </View>
  );
}

export const EditableText = React.memo(EditableTextComponent);
