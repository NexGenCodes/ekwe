import AudioLines from "lucide-react-native/icons/audio-lines";
import Check from "lucide-react-native/icons/check";
import Play from "lucide-react-native/icons/play";
import Mars from "lucide-react-native/icons/mars";
import Venus from "lucide-react-native/icons/venus";
import { useValue } from "@legendapp/state/react";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import {
  getVoiceById,
  getVoicesByGender,
  type Voice,
  type VoiceGender,
} from "@ekwe/shared";

import { Sheet } from "@/components/ui/Sheet";
import { ProBadge } from "@/components/ProBadge";
import { LockedPressable } from "@/components/LockedPressable";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { auth$ } from "@/store";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";

export interface VoicePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  currentVoiceId: string | null;
  onSelect: (voice: Voice) => void;
  onPreview?: (voice: Voice) => void;
  currentGender?: VoiceGender;

  title?: string;
}

function VoiceCard({
  voice,
  selected,
  locked,
  onPress,
  onPreview,
  color,
}: {
  voice: Voice;
  selected: boolean;
  locked: boolean;
  onPress: () => void;
  onPreview?: () => void;
  color: ReturnType<typeof useTheme>["color"];
}): React.ReactElement {
  const isBuiltin = voice.origin === "builtin";

  return (
    <LockedPressable
      locked={locked}
      navigateToBilling
      onPress={onPress}
      accessibilityLabel={`${voice.name}, ${voice.tagline}`}
      accessibilityHint={locked ? "Requires Ekwe Pro subscription" : undefined}
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
      {}
      <Box
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isBuiltin
            ? withAlpha(color.brand, 0.14)
            : withAlpha(color.foreground, 0.06),
        }}
      >
        {isBuiltin ? (
          <AudioLines size={20} color={color.brand} />
        ) : (
          <Text
            variant="body"
            style={{ color: color.foreground, fontWeight: "700" }}
          >
            {voice.name.charAt(0)}
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

      {}
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
            {voice.name}
          </Text>
          {voice.tier === "pro" && <ProBadge />}
        </Box>
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color: color.muted, marginTop: 4 }}
        >
          {voice.tagline}
        </Text>
      </Box>

      {}
      {onPreview && !locked && (
        <Pressable
          onPress={onPreview}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${voice.name}`}
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
          <Play size={15} color={color.brand} fill={color.brand} />
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
  currentGender,
  title = "Choose a voice",
}: VoicePickerSheetProps): React.JSX.Element {
  const { color } = useTheme();
  const isPro = useValue(() => auth$.isPro.get());

  const current = useMemo(
    () => (currentVoiceId ? (getVoiceById(currentVoiceId) ?? null) : null),
    [currentVoiceId],
  );

  const [gender, setGender] = useState<VoiceGender>(
    currentGender ?? current?.gender ?? "female",
  );

  useEffect(() => {
    if (currentGender) {
      setGender(currentGender);
    } else if (current) {
      setGender(current.gender);
    }
  }, [current, currentGender]);

  const voices = useMemo(() => getVoicesByGender(gender), [gender]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Box style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        {}
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
                  triggerHaptic();
                  setGender(key);
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
          {voices.map((voice) => {
            const locked = voice.tier === "pro" && !isPro;
            const effective =
              voice.origin === "standard" ? { ...voice, gender } : voice;
            return (
              <VoiceCard
                key={voice.id}
                voice={voice}
                color={color}
                selected={currentVoiceId === voice.id}
                locked={locked}
                onPress={() => {
                  if (!locked) onSelect(effective);
                }}
                onPreview={
                  onPreview && !locked
                    ? (): void => {
                        void onPreview(effective);
                      }
                    : undefined
                }
              />
            );
          })}
        </ScrollView>
      </Box>
    </Sheet>
  );
}
