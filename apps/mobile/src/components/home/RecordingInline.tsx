import Play from "lucide-react-native/icons/play";
import Pause from "lucide-react-native/icons/pause";
import React, { useEffect, useState } from "react";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  useAnimatedReaction,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";

import { AudioWaveform } from "@/components/AudioWaveform";
import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useSharedAudioPlayer } from "@/hooks";
import type { DictationStatus } from "@/hooks/useVoiceDictation";

const BARS = 40;

const fmtTime = (seconds: number): string => {
  "worklet";
  if (!seconds || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

const resample = (data: number[], n: number): number[] => {
  if (!data?.length) {
    return Array.from(
      { length: n },
      (_, i) => 0.15 + Math.sin((i / (n - 1)) * Math.PI) * 0.4,
    );
  }
  const out: number[] = [];
  let mx = 0.001;
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i / n) * data.length);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / n) * data.length));
    let sum = 0;
    let pk = 0;
    for (let j = lo; j < hi; j++) {
      const v = data[j] ?? 0;
      sum += v;
      if (v > pk) pk = v;
    }
    const blended = (pk + sum / (hi - lo)) / 2;
    if (blended > mx) mx = blended;
    out.push(blended);
  }
  return out.map((v) => Math.min(1, Math.max(0.02, v / mx)));
};

interface RecordingInlineProps {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  capturedUri: string | null;
  meteringData: number[];
  isLive?: boolean;
  interimText?: string;
  finalText?: string;
}

export function RecordingInline({
  status,
  amplitude,
  elapsedMs,
  capturedUri,
  meteringData,
  isLive = false,
  interimText = "",
  finalText = "",
}: RecordingInlineProps): React.ReactElement {
  const { color } = useTheme();
  const isProcessing = status === "processing";
  const isPreview = status === "preview";
  const isRecording = status === "recording";

  const player = useSharedAudioPlayer(isPreview ? capturedUri : null);

  // WhatsApp style: fill with 0, newest element pushes from the right side.
  const history = useSharedValue<number[]>(new Array(BARS).fill(0));

  useAnimatedReaction(
    () => amplitude.value,
    (val) => {
      const oldArr = history.value;
      const newArr = new Array(BARS);
      for (let i = 0; i < BARS - 1; i++) {
        newArr[i] = oldArr[i + 1];
      }
      newArr[BARS - 1] = val;
      history.value = newArr;
    },
    [amplitude, history],
  );

  const dotOp = useSharedValue(1);
  useEffect(() => {
    if (isRecording) {
      dotOp.value = withRepeat(withTiming(0.2, { duration: 600 }), -1, true);
      history.value = new Array(BARS).fill(0);
    } else {
      dotOp.value = 1;
    }
  }, [isRecording, dotOp, history]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOp.value }));

  const widthSV = useSharedValue(200);

  const previewPeaksSV = useSharedValue<number[]>(new Array(BARS).fill(0.02));

  useEffect(() => {
    if (isPreview && meteringData.length > 0) {
      previewPeaksSV.value = resample(meteringData, BARS);
    }
  }, [isPreview, meteringData, previewPeaksSV]);

  const thumbStyle = useAnimatedStyle(() => {
    const frac =
      player.duration > 0 ? player.progressSV.value / player.duration : 0;
    return { transform: [{ translateX: frac * widthSV.value }] };
  });

  const [displayTime, setDisplayTime] = useState("0:00");
  useAnimatedReaction(
    () => player.progressSV.value,
    (ms) => {
      runOnJS(setDisplayTime)(fmtTime(ms));
    },
  );

  const hasLiveText = isLive && isRecording && (interimText || finalText);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 72,
        borderRadius: borderRadius["2xl"],
        borderCurve: "continuous",
        paddingHorizontal: spacing.md,
        backgroundColor: color.surface,
      }}
    >
      {isPreview ? (
        <Box
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: spacing.xs,
          }}
        >
          <Pressable
            onPress={() => (player.isPlaying ? player.pause() : player.play())}
            disabled={!player.isLoaded || player.isDecoding}
            accessibilityLabel={
              player.isPlaying ? "Pause preview" : "Play preview"
            }
            accessibilityState={{
              disabled: !player.isLoaded || player.isDecoding,
            }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              boxShadow: shadows.soft,
              backgroundColor: color.brand,
              opacity: player.isLoaded && !player.isDecoding ? 1 : 0.5,
            }}
          >
            {!player.isLoaded || player.isDecoding ? (
              <Spinner size="sm" color={color.onBrand} />
            ) : player.isPlaying ? (
              <Pause size={20} color={color.onBrand} fill={color.onBrand} />
            ) : (
              <Play
                size={20}
                color={color.onBrand}
                fill={color.onBrand}
                style={{ marginLeft: 3 }}
              />
            )}
          </Pressable>

          <Box
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              height: 40,
              marginLeft: spacing.md,
              marginRight: spacing.sm,
            }}
          >
            <Box
              style={{ flex: 1, height: 40, position: "relative" }}
              onLayout={(e) => {
                widthSV.value = e.nativeEvent.layout.width;
              }}
            >
              <AudioWaveform
                amplitudes={previewPeaksSV}
                progressSV={player.progressSV}
                duration={player.duration}
                barCount={BARS}
                height={40}
                activeColor={color.brand}
                inactiveColor={color.muted}
                interactive
                onSeek={(p) => void player.endScrub(p * player.duration)}
                onScrubStateChange={(isScrubbing) => {
                  if (isScrubbing) player.beginScrub();
                }}
              />
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: color.brand,
                    left: -6,
                    top: 14,
                    boxShadow: shadows.soft,
                  },
                  thumbStyle,
                ]}
              />
            </Box>
          </Box>

          <Text
            variant="bodySmall"
            style={{ color: color.foreground, width: 40, textAlign: "right" }}
          >
            {player.isPlaying ? displayTime : fmtTime(player.duration)}
          </Text>
        </Box>
      ) : (
        <Box
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: spacing.sm,
          }}
        >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              marginRight: spacing.sm,
            }}
          >
            <Animated.View
              style={[
                {
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: color.error,
                },
                dotStyle,
              ]}
            />
            <Text variant="heading3" style={{ color: color.foreground }}>
              {fmtTime(elapsedMs / 1000)}
            </Text>
          </Box>

          <Box
            style={{
              flex: 1,
              height: 40,
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {isProcessing ? (
              <Text
                variant="body"
                style={{ color: color.muted, textAlign: "center" }}
              >
                Transcribing...
              </Text>
            ) : (
              <AudioWaveform
                amplitudes={history}
                interactive={false}
                activeColor={color.brand}
                inactiveColor={color.foreground}
              />
            )}
          </Box>

          {isRecording && (
            <Box
              style={{
                position: "absolute",
                bottom: spacing.xs,
                left: spacing.sm,
                right: spacing.sm,
              }}
              pointerEvents="none"
            >
              {hasLiveText && (
                <Box
                  style={{
                    backgroundColor: color.surface + "E6",
                    borderRadius: borderRadius.sm,
                    paddingHorizontal: spacing.xs,
                    paddingVertical: 1,
                    alignSelf: "flex-start",
                  }}
                >
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    style={{ color: color.foreground, fontSize: 10 }}
                  >
                    {finalText ? `${finalText} ${interimText}` : interimText}
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Animated.View>
  );
}
