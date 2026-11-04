import AudioLines from "lucide-react-native/icons/audio-lines";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Pause from "lucide-react-native/icons/pause";
import Pencil from "lucide-react-native/icons/pencil";
import Play from "lucide-react-native/icons/play";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Share from "lucide-react-native/icons/share";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useRef, useState } from "react";
import { StyleProp, ViewStyle } from "react-native";
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
  /** Returns to the composer with the text still in hand, to change it. */
  onEdit: () => void;
  onChangeVoice: () => void;
  onConvert: () => void;
  /**
   * Whether the selected voice differs from the one on screen. Re-convert is
   * only meaningful then, and enabling it unconditionally invited a tap that
   * spent quota to produce the identical clip.
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

  onClear: () => void;
  onTogglePlay: () => void;

  isAudioLoading?: boolean;
  isConverting?: boolean;
  style?: StyleProp<ViewStyle>;
}

const EMPTY_PEAKS: number[] = [];

/**
 * Two weights for the result actions. `chip` is the quiet, bordered peer for
 * picking a voice; `primary` is a filled action that reads as the strong one
 * against it — used for re-rendering the audio in the voice just chosen.
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
  variant?: "chip" | "primary";
  disabled?: boolean;
  busy?: boolean;
}): React.ReactElement {
  const { color } = useTheme();
  const isPrimary = variant === "primary";
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
          paddingHorizontal: spacing.md,
          borderRadius: borderRadius.xl,
          borderWidth: isPrimary ? 0 : 1,
          borderColor: withAlpha(tint, 0.35),
          backgroundColor: isPrimary ? tint : withAlpha(tint, 0.12),
          flex: 1,
        },
        pressed && !disabled && { transform: [{ scale: 0.96 }] },
      ]}
    >
      {icon}
      <Text
        variant="label"
        numberOfLines={1}
        style={{ color: isPrimary ? color.brand : tint }}
      >
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
  onEdit,
  onChangeVoice,
  onConvert,
  canConvert: voiceChanged,
  onShare,
  resultText,
  transcriptText,
  hasTranslation,
  onClear,
  onTogglePlay,
  isAudioLoading = false,
  isConverting = false,
  style,
}: VoiceResultPanelProps): React.ReactElement {
  const { color } = useTheme();

  // Convert renders the spoken document, so that is what gates it — and it only
  // differs from what is on screen once the voice has changed.
  const canConvert = voiceChanged && resultText.trim().length > 0;

  const isPlaying = player.isPlaying;
  const isPlayLoading = isConverting || !player.isReady || player.isDecoding;
  const isEditDisabled = isAudioLoading || isConverting;
  const isShareDisabled = isConverting || isAudioLoading;
  const hasWaveform = !!amplitudes && amplitudes.length > 0;
  const hasLoadError = !!player.loadError;

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
  const [showOriginal, setShowOriginal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
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
      <Box
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.md,
        }}
      >
        <Pressable
          onPress={onEdit}
          disabled={isEditDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            isConverting
              ? "Re-rendering audio, please wait"
              : isAudioLoading
                ? "Preparing audio, please wait"
                : "Edit"
          }
          accessibilityState={{
            disabled: isEditDisabled,
            busy: isEditDisabled,
          }}
          hitSlop={10}
          style={({ pressed }) => [
            {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              minHeight: touchTarget.minimum,
              paddingRight: spacing.sm,
              opacity: isEditDisabled ? opacity.disabled : 1,
            },
            pressed && !isEditDisabled && { opacity: 0.7 },
          ]}
        >
          {isEditDisabled ? (
            <Spinner size="sm" color={color.onBrand} />
          ) : (
            <Pencil size={iconSize.sm} color={color.onBrand} />
          )}
          <Text variant="label" style={{ color: color.onBrand }}>
            {isConverting
              ? "Re-rendering…"
              : isAudioLoading
                ? "Preparing…"
                : "Edit"}
          </Text>
        </Pressable>

        <IconButton
          accessibilityLabel="Clear session"
          onPress={onClear}
          disabled={isConverting || isAudioLoading}
          backgroundColor={withAlpha(color.onBrand, 0.16)}
          size={touchTarget.minimum}
          icon={
            <X size={iconSize.sm} color={color.onBrand} strokeWidth={2.4} />
          }
        />
      </Box>

      <Pressable
        onPress={onChangeVoice}
        disabled={isConverting}
        accessibilityRole="button"
        accessibilityLabel={`Selected voice: ${voice.name}. Tap to change voice.`}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.md,
          },
          pressed && !isConverting && { opacity: 0.8 },
        ]}
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
      </Pressable>

      <Pressable
        onPress={() => setIsExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={
          isExpanded ? "Collapse full text" : "Expand full text"
        }
        style={{ paddingVertical: spacing.xs }}
      >
        <Text
          variant="heading2"
          numberOfLines={isExpanded ? undefined : 4}
          style={{ color: color.onBrand }}
        >
          {resultText}
        </Text>
        {resultText.length > 120 && (
          <Text
            variant="caption"
            style={{
              color: withAlpha(color.onBrand, 0.7),
              marginTop: spacing.xs,
              textDecorationLine: "underline",
            }}
          >
            {isExpanded ? "Show less" : "Show more"}
          </Text>
        )}
      </Pressable>

      {hasTranslation && transcriptText.trim().length > 0 && (
        <>
          <Pressable
            onPress={() => setShowOriginal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={
              showOriginal ? "Hide original" : "Show original"
            }
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              marginBottom: spacing.xs,
            }}
          >
            {showOriginal ? (
              <ChevronDown size={iconSize.sm} color={color.onBrand} />
            ) : (
              <ChevronRight size={iconSize.sm} color={color.onBrand} />
            )}
            <Text variant="caption" style={{ color: color.onBrand }}>
              {showOriginal ? "Hide original" : "Show original"}
            </Text>
          </Pressable>
          {showOriginal && (
            <Text
              variant="caption"
              numberOfLines={3}
              style={{
                color: color.onBrand,
                fontStyle: "italic",
                marginBottom: spacing.sm,
              }}
            >
              {`said: "${transcriptText}"`}
            </Text>
          )}
        </>
      )}

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
          onPress={
            hasLoadError
              ? player.retryLoad
              : isPlayLoading
                ? undefined
                : onTogglePlay
          }
          disabled={isPlayLoading && !hasLoadError}
          accessibilityRole="button"
          accessibilityLabel={
            hasLoadError
              ? "Retry loading audio"
              : isConverting
                ? "Rendering audio"
                : isPlayLoading
                  ? "Preparing playback"
                  : isPlaying
                    ? "Pause voice note"
                    : "Play voice note"
          }
          accessibilityState={{
            disabled: isPlayLoading && !hasLoadError,
            busy: isPlayLoading,
          }}
          hitSlop={8}
          style={({ pressed }) => [
            {
              width: touchTarget.comfortable,
              height: touchTarget.comfortable,
              borderRadius: touchTarget.comfortable / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: withAlpha(color.onBrand, 0.18),
              opacity: isPlayLoading && !hasLoadError ? 0.6 : 1,
            },
            pressed && !isPlayLoading && { transform: [{ scale: 0.92 }] },
          ]}
        >
          {hasLoadError ? (
            <RefreshCw size={iconSize.md} color={color.onBrand} />
          ) : isPlayLoading ? (
            <Spinner size="sm" color={color.onBrand} />
          ) : isPlaying ? (
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
            interactive={!isConverting && player.isReady && !player.isDecoding}
            activeColor={color.onBrand}
            inactiveColor={withAlpha(color.onBrand, 0.6)}
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
          label="Voices"
          onPress={onChangeVoice}
          tint={color.onBrand}
          disabled={isConverting}
        />
        {canConvert && (
          <ActionChip
            icon={
              isConverting ? (
                <Spinner size="sm" color={color.brand} />
              ) : (
                <RefreshCw size={iconSize.sm} color={color.brand} />
              )
            }
            label={isConverting ? "Re-rendering…" : "Re-render"}
            onPress={onConvert}
            tint={color.onBrand}
            variant="primary"
            disabled={isConverting}
            busy={isConverting}
          />
        )}
      </Box>

      <Pressable
        onPress={isShareDisabled ? undefined : onShare}
        disabled={isShareDisabled}
        accessibilityRole="button"
        accessibilityLabel="Share voice"
        accessibilityState={{ disabled: isShareDisabled }}
        hitSlop={8}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            minHeight: touchTarget.comfortable,
            borderRadius: borderRadius.xl,
            borderWidth: canConvert ? 1.5 : 0,
            borderColor: canConvert
              ? withAlpha(color.onBrand, 0.4)
              : "transparent",
            backgroundColor: canConvert
              ? withAlpha(color.onBrand, 0.08)
              : color.onBrand,
            opacity: isShareDisabled ? opacity.disabled : 1,
          },
          pressed &&
            !isShareDisabled && {
              transform: [{ scale: 0.98 }],
              opacity: 0.92,
            },
        ]}
      >
        <Share
          size={iconSize.sm}
          color={canConvert ? color.onBrand : color.brand}
          strokeWidth={2.2}
        />
        <Text
          variant="heading3"
          style={{ color: canConvert ? color.onBrand : color.brand }}
        >
          Share voice
        </Text>
      </Pressable>
    </Animated.View>
  );
});
