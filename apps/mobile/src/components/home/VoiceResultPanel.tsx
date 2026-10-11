import ArrowLeft from "lucide-react-native/icons/arrow-left";
import AudioLines from "lucide-react-native/icons/audio-lines";
import Pause from "lucide-react-native/icons/pause";
import Pencil from "lucide-react-native/icons/pencil";
import Play from "lucide-react-native/icons/play";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Share from "lucide-react-native/icons/share";
import Wand from "lucide-react-native/icons/wand";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, StyleProp, ViewStyle } from "react-native";
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { VoiceGender, VoiceSlot } from "@ekwe/shared";

import { IconButton } from "@/components/IconButton";
import { AudioWaveform } from "@/components/AudioWaveform";
import {
  EditableText,
  type EditFieldKey,
  type EditableField,
} from "@/components/home/EditableText";

import { Box, Pressable, Spinner, Text } from "@/components/ui";
import {
  borderRadius,
  iconSize,
  opacity,
  touchTarget,
} from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import type { SharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { withAlpha } from "@/utils/color";
import { formatClock } from "@/utils/formatDuration";

export interface VoiceResultPanelProps {
  player: SharedAudioPlayer;

  voice: VoiceSlot;
  voiceGender?: VoiceGender;

  langName: string;

  durationSeconds: number;

  amplitudes?: number[];
  onBack: () => void;
  onChangeVoice: () => void;
  onConvert: () => void;
  /**
   * Whether the selected voice differs from the one on screen. Convert is only
   * meaningful then, and enabling it unconditionally invited a tap that spent
   * quota to produce the identical clip.
   */
  canConvert: boolean;
  onShare: () => void;

  /**
   * The text being sent — the translation when there is one, otherwise what was
   * said. This is the artifact; the audio is its read-aloud.
   */
  resultText: string;
  /**
   * What the app heard, or what was typed before translation.
   *
   * Shown as its own line only when it differs from `resultText`; when the
   * result *is* the transcript, a second copy of the same words is noise.
   */
  transcriptText: string;
  /** True when a translation exists, so the transcript is a distinct document. */
  hasTranslation: boolean;
  isEditing: boolean;
  /** One entry per document the editor may correct. */
  editFields: EditableField[];
  /** What Convert will do with the current draft. */
  editHint: string;
  maxChars: number;
  /** Open the editor on the primary result text. */
  onEditResult: () => void;
  onEditFieldChange: (key: EditFieldKey, next: string) => void;
  onCancelEdit: () => void;
  onApplyEdit: () => void;

  onClear: () => void;
  onTogglePlay: () => void;

  isAudioLoading?: boolean;
  isConverting?: boolean;
  style?: StyleProp<ViewStyle>;
}

const EMPTY_PEAKS: number[] = [];

/**
 * `quiet` is for a tertiary action that should not read as a peer of the primary
 * button: no border, no fill, and it hugs its label instead of dividing the row
 * evenly. The bordered `chip` look is right when two actions compete, and wrong
 * when one sits alone under the text it modifies.
 */
function ActionChip({
  icon,
  label,
  onPress,
  tint,
  variant = "chip",
  disabled = false,
  busy = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  tint: string;
  variant?: "chip" | "quiet";
  disabled?: boolean;
  busy?: boolean;
}): React.ReactElement {
  const isQuiet = variant === "quiet";
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      hitSlop={8}
      style={({ pressed }) => [
        disabled && { opacity: 0.4 },
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs,
          minHeight: touchTarget.minimum,
          paddingHorizontal: isQuiet ? 0 : spacing.md,
          borderRadius: borderRadius.xl,
          borderWidth: isQuiet ? 0 : 1,
          borderColor: withAlpha(tint, 0.35),
          backgroundColor: isQuiet ? "transparent" : withAlpha(tint, 0.12),
        },
        // Only a filled chip is competing for the row, so only it flexes.
        !isQuiet && { flex: 1 },

        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      {icon}
      <Text variant="label" numberOfLines={1} style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

export const VoiceResultPanel = React.memo(function VoiceResultPanel({
  player,
  voice,
  voiceGender,
  langName,
  durationSeconds,
  amplitudes,
  onBack,
  onChangeVoice,
  onConvert,
  canConvert: voiceChanged,
  onShare,
  resultText,
  transcriptText,
  hasTranslation,
  isEditing,
  editFields,
  editHint,
  maxChars,
  onEditResult,
  onEditFieldChange,
  onCancelEdit,
  onApplyEdit,
  onClear,
  onTogglePlay,
  isAudioLoading = false,
  isConverting = false,
  style,
}: VoiceResultPanelProps): React.ReactElement {
  const { color } = useTheme();

  // Convert renders the spoken document, so that is what gates it — and it only
  // differs from what is on screen once the voice has changed.
  const primary =
    editFields.find((f) => f.key === "translation") ?? editFields[0];
  const canConvert = voiceChanged && (primary?.value.trim().length ?? 0) > 0;

  const isPlaying = player.isPlaying;
  const hasWaveform = !!amplitudes && amplitudes.length > 0;

  // The panel's own `durationSeconds` is the worker's estimate, so it is only
  // the fallback. The player's duration is measured from the decoded clip, and
  // progress is a fraction of this — a mismatch here shows up as a bar that
  // stops short of its own end.
  const totalSeconds = player.duration > 0 ? player.duration : durationSeconds;

  const { endScrub, beginScrub } = player;
  const totalSecondsRef = useRef(totalSeconds);
  totalSecondsRef.current = totalSeconds;
  const handleSeek = useCallback(
    (progress: number) => {
      void endScrub(progress * totalSecondsRef.current);
    },
    [endScrub],
  );
  const handleScrubStateChange = useCallback(
    (isScrubbing: boolean) => {
      if (isScrubbing) beginScrub();
    },
    [beginScrub],
  );

  const [displaySeconds, setDisplaySeconds] = useState(0);
  useAnimatedReaction(
    () => Math.floor(player.progressSV.value),
    (seconds) => {
      runOnJS(setDisplaySeconds)(seconds);
    },
    [player.progressSV],
  );

  const widthSV = useSharedValue(200);
  const thumbStyle = useAnimatedStyle(() => {
    const dur = totalSeconds > 0 ? totalSeconds : 1;
    const frac = Math.min(Math.max(player.progressSV.value / dur, 0), 1);
    return { transform: [{ translateX: frac * widthSV.value }] };
  }, [totalSeconds]);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[
        {
          borderRadius: borderRadius["2xl"],
          borderCurve: "continuous",
          padding: spacing.lg,
          backgroundColor: color.brand,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {}
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.md,
        }}
      >
        <Pressable
          onPress={onBack}
          disabled={isAudioLoading}
          accessibilityRole="button"
          accessibilityLabel={
            isAudioLoading ? "Preparing audio, please wait" : "Back"
          }
          accessibilityState={{ disabled: isAudioLoading }}
          hitSlop={10}
          style={({ pressed }) => [
            {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              minHeight: touchTarget.minimum,
              paddingRight: spacing.sm,
              opacity: isAudioLoading ? opacity.disabled : 1,
            },
            pressed && !isAudioLoading && { opacity: 0.7 },
          ]}
        >
          {isAudioLoading ? (
            <Spinner size="sm" color={color.onBrand} />
          ) : (
            <ArrowLeft size={iconSize.sm} color={color.onBrand} />
          )}
          <Text variant="label" style={{ color: color.onBrand }}>
            {isAudioLoading ? "Preparing…" : "Back"}
          </Text>
        </Pressable>

        <IconButton
          accessibilityLabel="Clear session"
          onPress={onClear}
          backgroundColor={color.onBrand}
          size={touchTarget.minimum}
          icon={<X size={iconSize.sm} color={color.error} strokeWidth={2.4} />}
        />
      </Box>

      {}
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <AudioLines size={iconSize.sm} color={color.onBrand} />
        <Box style={{ flexShrink: 1 }}>
          <Text
            variant="heading3"
            numberOfLines={1}
            style={{ color: color.onBrand }}
          >
            {voice.name}
            {voiceGender
              ? ` · ${voiceGender === "male" ? "Male" : "Female"}`
              : ""}
          </Text>
          <Text
            variant="bodySmall"
            numberOfLines={1}
            style={{ color: color.onBrand }}
          >
            {langName}
          </Text>
        </Box>
      </Box>

      {}
      <EditableText
        text={resultText}
        fields={editFields}
        onChangeField={onEditFieldChange}
        onCancel={onCancelEdit}
        isEditing={isEditing}
        hint={editHint}
        maxChars={maxChars}
      />

      {!isEditing && (
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            marginBottom: spacing.sm,
          }}
        >
          <ActionChip
            icon={<Pencil size={iconSize.sm} color={color.onBrand} />}
            label="Edit text"
            onPress={onEditResult}
            tint={color.onBrand}
            variant="quiet"
          />
        </Box>
      )}

      {!isEditing && hasTranslation && transcriptText.trim().length > 0 && (
        <Text
          variant="caption"
          numberOfLines={2}
          style={{
            color: color.onBrand,
            fontStyle: "italic",
            marginBottom: spacing.sm,
          }}
        >
          {`said: "${transcriptText}"`}
        </Text>
      )}

      {isEditing ? (
        <>
          {/* Editing shows words and nothing else. The audio on screen would
              be the pre-edit rendering, so putting it here invites the reader
              to trust something that no longer matches the text. */}
          <Box style={{ height: spacing.lg }} />
          <Pressable
            onPress={onApplyEdit}
            disabled={!canConvert}
            accessibilityRole="button"
            accessibilityLabel="Convert"
            accessibilityHint={editHint}
            accessibilityState={{ disabled: !canConvert }}
            hitSlop={8}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                minHeight: touchTarget.comfortable,
                borderRadius: borderRadius.xl,
                backgroundColor: color.onBrand,
                opacity: canConvert ? 1 : 0.5,
              },
              pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
            ]}
          >
            <Wand size={iconSize.sm} color={color.brand} strokeWidth={2.2} />
            <Text variant="heading3" style={{ color: color.brand }}>
              Convert
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          {}
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              marginTop: spacing.lg,
              marginBottom: spacing.lg,
            }}
          >
            <Pressable
              onPress={onTogglePlay}
              accessibilityRole="button"
              accessibilityLabel={
                isPlaying ? "Pause voice note" : "Play voice note"
              }
              hitSlop={8}
              style={({ pressed }) => [
                {
                  width: touchTarget.comfortable,
                  height: touchTarget.comfortable,
                  borderRadius: touchTarget.comfortable / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: withAlpha(color.onBrand, 0.18),
                },
                pressed && { transform: [{ scale: 0.92 }] },
              ]}
            >
              {isPlaying ? (
                <Pause size={iconSize.md} color={color.onBrand} />
              ) : (
                <Play
                  size={iconSize.md}
                  color={color.onBrand}
                  fill={color.onBrand}
                  style={{ marginLeft: 3 }}
                />
              )}
            </Pressable>

            <Box
              style={{ flex: 1, height: 34, position: "relative" }}
              onLayout={(e) => {
                widthSV.value = e.nativeEvent.layout.width;
              }}
            >
              <AudioWaveform
                amplitudes={amplitudes ?? EMPTY_PEAKS}
                progressSV={player.progressSV}
                duration={totalSeconds}
                barCount={48}
                barWidth={3}
                barGap={2}
                height={34}
                interactive
                activeColor={color.onBrand}
                inactiveColor={withAlpha(color.onBrand, 0.35)}
                onSeek={handleSeek}
                onScrubStateChange={handleScrubStateChange}
              />
              {hasWaveform && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: "absolute",
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: color.onBrand,
                      left: -6,
                      top: 11,
                    },
                    thumbStyle,
                  ]}
                />
              )}
            </Box>

            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{ color: color.onBrand, textAlign: "right" }}
            >
              {formatClock(displaySeconds)} / {formatClock(totalSeconds)}
            </Text>
          </Box>
        </>
      )}

      {!isEditing && (
        <>
          {}
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              marginBottom: spacing.md,
            }}
          >
            <ActionChip
              icon={<AudioLines size={iconSize.sm} color={color.onBrand} />}
              label="Change Voice"
              onPress={onChangeVoice}
              tint={color.onBrand}
            />
            <ActionChip
              icon={
                isConverting ? (
                  <ActivityIndicator size="small" color={color.onBrand} />
                ) : (
                  <RefreshCw size={iconSize.sm} color={color.onBrand} />
                )
              }
              label={isConverting ? "Converting…" : "Convert"}
              onPress={onConvert}
              tint={color.onBrand}
              disabled={!canConvert || isConverting}
              busy={isConverting}
            />
          </Box>

          {}
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share voice note"
            hitSlop={8}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                minHeight: touchTarget.comfortable,
                borderRadius: borderRadius.xl,
                backgroundColor: color.onBrand,
              },
              pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 },
            ]}
          >
            <Share size={iconSize.sm} color={color.brand} strokeWidth={2.2} />
            <Text variant="heading3" style={{ color: color.brand }}>
              Share voice note
            </Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
});
