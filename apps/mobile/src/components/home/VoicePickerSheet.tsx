import AudioLines from "lucide-react-native/icons/audio-lines";
import Check from "lucide-react-native/icons/check";
import Pause from "lucide-react-native/icons/pause";
import Play from "lucide-react-native/icons/play";
import Mars from "lucide-react-native/icons/mars";
import Venus from "lucide-react-native/icons/venus";
import { useValue } from "@legendapp/state/react";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { VOICE_SLOTS, type VoiceGender, type VoiceSlot } from "@ekwe/shared";

import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { PaidBadge } from "@/components/PaidBadge";
import { LockedPressable } from "@/components/LockedPressable";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { auth$ } from "@/store";
import { withAlpha } from "@/utils/color";
import type { PreviewPhase } from "@/hooks/audio/useVoicePreview";
import type { VoiceSelection } from "@/utils/voices";
import { triggerHaptic } from "@/utils/haptics";

export interface VoicePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  currentVoiceId: string | null;
  onSelect: (selection: VoiceSelection) => void;
  onPreview?: (selection: VoiceSelection) => void;
  /** The voice currently loading or playing, as `${slotId}_${gender}`. */
  activePreviewKey?: string | null;
  previewPhase?: PreviewPhase | null;
  /**
   * Fires when the user changes the She/He tab. Persisting this immediately
   * keeps the tab, the previewed voice, and the next synthesis in agreement.
   */
  onGenderChange?: (gender: VoiceGender) => void;
  currentGender?: VoiceGender;

  title?: string;
}

function VoiceCard({
  slot,
  gender,
  selected,
  locked,
  onPress,
  onPreview,
  previewPhase,
  color,
}: {
  slot: VoiceSlot;
  gender: VoiceGender;
  selected: boolean;
  locked: boolean;
  onPress: () => void;
  onPreview?: () => void;
  previewPhase?: PreviewPhase | null;
  color: ReturnType<typeof useTheme>["color"];
}): React.ReactElement {
  const isProSlot = slot.tier === "pro";

  return (
    <LockedPressable
      locked={locked}
      navigateToBilling
      onPress={onPress}
      accessibilityLabel={`${slot.name}, ${slot.tagline}`}
      accessibilityHint={locked ? "Requires the Ekwe Paid plan" : undefined}
      accessibilityState={{ selected }}
      accessible={false}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: borderRadius.xl,
          borderCurve: "continuous",
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? color.brand : color.border,
          backgroundColor: selected ? withAlpha(color.brand, 0.08) : color.card,
        },
        locked && { borderStyle: "dashed" },
        !locked && pressed && { transform: [{ scale: 0.99 }] },
      ]}
      contentStyle={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      <Box
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isProSlot
            ? withAlpha(color.brand, 0.14)
            : withAlpha(color.foreground, 0.06),
        }}
      >
        {isProSlot ? (
          <AudioLines size={20} color={color.brand} />
        ) : (
          <Text
            variant="body"
            style={{ color: color.foreground, fontWeight: "700" }}
          >
            {slot.name.charAt(0)}
          </Text>
        )}
        {selected && (
          <Box
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              width: 22,
              height: 22,
              borderRadius: 11,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color.brand,
            }}
          >
            <Check size={13} color={color.onBrand} strokeWidth={4} />
          </Box>
        )}
      </Box>

      <Box style={{ flex: 1 }}>
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          <Text
            variant="body"
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: color.foreground,
              fontWeight: selected ? "700" : "600",
            }}
          >
            {slot.name}
          </Text>
          {slot.tier === "pro" && <PaidBadge />}
        </Box>
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color: color.muted, marginTop: 4 }}
        >
          {slot.tagline}
        </Text>
      </Box>

      {onPreview && (
        <Pressable
          onPress={onPreview}
          hitSlop={8}
          accessible
          accessibilityRole="button"
          accessibilityState={{ busy: previewPhase === "loading" }}
          accessibilityLabel={
            previewPhase === "playing"
              ? `Stop preview of ${slot.name}, ${gender}`
              : previewPhase === "loading"
                ? `Loading preview of ${slot.name}, ${gender}`
                : `Preview ${slot.name}, ${gender}`
          }
          style={({ pressed }) => [
            {
              width: 40,
              height: 40,
              borderRadius: 20,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected
                ? withAlpha(color.brand, 0.18)
                : withAlpha(color.brand, 0.1),
            },
            pressed && { transform: [{ scale: 0.9 }] },
          ]}
        >
          {previewPhase === "loading" ? (
            <Spinner size="sm" color={color.brand} />
          ) : previewPhase === "playing" ? (
            <Pause size={15} color={color.brand} fill={color.brand} />
          ) : (
            <Play size={15} color={color.brand} fill={color.brand} />
          )}
        </Pressable>
      )}
    </LockedPressable>
  );
}

export function VoicePickerSheet({
  visible,
  onClose,
  currentVoiceId,
  onSelect,
  onPreview,
  activePreviewKey = null,
  previewPhase = null,
  onGenderChange,
  currentGender,
  title = "Choose a voice",
}: VoicePickerSheetProps): React.JSX.Element {
  const { color } = useTheme();
  const isPro = useValue(() => auth$.isPro.get());

  const [gender, setGender] = useState<VoiceGender>(currentGender ?? "female");

  // The tab always reflects the persisted gender, so a preview, a selection
  // and the next synthesis can never disagree about which gender is active.
  useEffect(() => {
    if (currentGender) setGender(currentGender);
  }, [currentGender]);

  const handleGenderPress = useCallback(
    (next: VoiceGender): void => {
      triggerHaptic();
      setGender(next);
      onGenderChange?.(next);
    },
    [onGenderChange],
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Box style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <Box
          style={{
            flexDirection: "row",
            gap: spacing.hairline,
            padding: 4,
            borderRadius: borderRadius.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: color.border,
            backgroundColor: color.surface,
          }}
        >
          {[
            { key: "female" as const, label: "She", Icon: Venus },
            { key: "male" as const, label: "He", Icon: Mars },
          ].map(({ key, label, Icon }) => {
            const active = gender === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  handleGenderPress(key);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.sm,
                    borderRadius: borderRadius.lg,
                    borderCurve: "continuous",
                    backgroundColor: active ? color.card : "transparent",
                  },
                  active && {
                    borderWidth: 1,
                    borderColor: withAlpha(color.brand, 0.35),
                  },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Icon
                  size={17}
                  color={active ? color.brand : color.muted}
                  strokeWidth={2.2}
                />
                <Text
                  variant="body"
                  style={{
                    color: active ? color.foreground : color.muted,
                    fontWeight: active ? "700" : "500",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.md,
            paddingVertical: spacing.md,
            paddingBottom: spacing["2xl"],
          }}
        >
          {VOICE_SLOTS.map((slot) => {
            const locked = slot.tier === "pro" && !isPro;
            // Slot and gender both have to match: both genders share a slot id,
            // so a slot-only check would mark the Studio card selected even
            // when the active voice is the other gender.
            const selected =
              currentVoiceId === slot.id && currentGender === gender;
            const selection: VoiceSelection = { slot, gender };
            // Only the card that owns the preview reflects it, so switching
            // tabs never leaves a spinner behind on the gender you left.
            const ownsPreview = activePreviewKey === `${slot.id}_${gender}`;
            return (
              <VoiceCard
                key={slot.id}
                slot={slot}
                gender={gender}
                color={color}
                selected={selected}
                locked={locked}
                onPress={() => {
                  if (!locked) onSelect(selection);
                }}
                onPreview={
                  onPreview
                    ? (): void => {
                        onPreview(selection);
                      }
                    : undefined
                }
                previewPhase={ownsPreview ? previewPhase : null}
              />
            );
          })}
        </ScrollView>
      </Box>
    </Sheet>
  );
}
