import { Play, Pause } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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

import { Box, Text, Pressable } from "@/components/ui";
import { shadows } from "@/constants";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme, useSharedAudioPlayer } from "@/hooks";
import type { DictationStatus } from "@/hooks/useVoiceDictation";

/* ─── Constants ───────────────────────────────────────────────── */
const BARS = 50;
const BAR_W = 3;
const BAR_R = 1.5;
const MIN_H = 4;
const MAX_H = 30;
const RANGE = MAX_H - MIN_H;

/* ─── Helpers ─────────────────────────────────────────────────── */
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

const fmtTime = (ms: number): string => {
  "worklet";
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

/* ═══════════════════════════════════════════════════════════════ */
/*  LIVE BAR — WhatsApp-style sliding waveform                     */
/* ═══════════════════════════════════════════════════════════════ */
const LiveBar = React.memo(function LiveBar({
  i,
  history,
  head,
  tint,
}: {
  i: number;
  history: SharedValue<number[]>;
  head: SharedValue<number>;
  tint: string;
}) {
  const style = useAnimatedStyle(() => {
    "worklet";
    const age = BARS - 1 - i;
    const idx = (head.value - age + BARS) % BARS;
    const raw = history.value[idx] ?? 0;
    const clamped = Math.min(1, Math.max(0.05, raw));

    return {
      height: MIN_H + clamped * RANGE,
    };
  });

  return (
    <Animated.View
      style={[
        { width: BAR_W, borderRadius: BAR_R, backgroundColor: tint },
        style,
      ]}
    />
  );
});

/* ═══════════════════════════════════════════════════════════════ */
/*  PREVIEW BAR — color changes with playback progress             */
/* ═══════════════════════════════════════════════════════════════ */
const PrevBar = React.memo(function PrevBar({
  i,
  h,
  prog,
  dur,
  on,
  off,
}: {
  i: number;
  h: number;
  prog: SharedValue<number>;
  dur: number;
  on: string;
  off: string;
}) {
  const style = useAnimatedStyle(() => {
    "worklet";
    const frac = dur > 0 ? prog.value / dur : 0;
    return { backgroundColor: i / BARS <= frac ? on : off };
  });

  return (
    <Animated.View
      style={[{ width: BAR_W, borderRadius: BAR_R, height: h }, style]}
    />
  );
});

/* ═══════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                 */
/* ═══════════════════════════════════════════════════════════════ */
interface RecordingInlineProps {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  capturedUri: string | null;
  meteringData: number[];
}

export function RecordingInline({
  status,
  amplitude,
  elapsedMs,
  capturedUri,
  meteringData,
}: RecordingInlineProps): React.ReactElement {
  const { color } = useTheme();
  const isProcessing = status === "processing";
  const isPreview = status === "preview";
  const isRecording = status === "recording";

  const player = useSharedAudioPlayer(isPreview ? capturedUri : null);

  // WhatsApp-style sliding history circular buffer
  const history = useSharedValue<number[]>(new Array(BARS).fill(0));
  const head = useSharedValue(0);

  // Reanimated Reaction: Push new amplitude values into the circular buffer
  useAnimatedReaction(
    () => amplitude.value,
    (val) => {
      const nextHead = (head.value + 1) % BARS;
      head.value = nextHead;

      history.modify((arr: number[]) => {
        arr[nextHead] = val;
        return arr;
      });
    },
    [amplitude, history, head],
  );

  /* ── Blinking red dot ── */
  const dotOp = useSharedValue(1);
  useEffect(() => {
    if (isRecording) {
      dotOp.value = withRepeat(withTiming(0.2, { duration: 600 }), -1, true);
      // Reset history when starting
      history.value = new Array(BARS).fill(0);
      head.value = 0;
    } else {
      dotOp.value = 1;
    }
  }, [isRecording, dotOp, history, head]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOp.value }));

  /* ── Seek / scrub gesture ── */
  const widthSV = useSharedValue(200);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          if (!isPreview || player.duration <= 0) return;
          const frac = Math.max(0, Math.min(1, e.x / widthSV.value));
          runOnJS(player.seek)(frac * player.duration);
        })
        .onChange((e) => {
          if (!isPreview || player.duration <= 0) return;
          const frac = Math.max(0, Math.min(1, e.x / widthSV.value));
          runOnJS(player.seek)(frac * player.duration);
        }),
    [isPreview, player.seek, player.duration, widthSV],
  );

  /* ── Preview peaks from metering data ── */
  const peaks = useMemo(() => {
    if (!isPreview) return [];
    const src =
      player.realWaveform.length > 0 ? player.realWaveform : meteringData;
    return resample(src, BARS);
  }, [isPreview, player.realWaveform, meteringData]);

  /* ── Build bars array (memoized, only re-creates on state change) ── */
  const bars = useMemo(() => {
    if (isProcessing) {
      return Array.from({ length: BARS }, (_, i) => {
        const h = 6 + Math.sin((i / (BARS - 1)) * Math.PI) * 18;
        return (
          <Animated.View
            key={i}
            style={{
              width: BAR_W,
              borderRadius: BAR_R,
              height: h,
              backgroundColor: color.muted,
              opacity: 0.5,
            }}
          />
        );
      });
    }
    if (isPreview) {
      return peaks.map((pk, i) => (
        <PrevBar
          key={i}
          i={i}
          h={MIN_H + pk * RANGE}
          prog={player.progressSV}
          dur={player.duration}
          on={color.brand} // played = bright color
          off={color.muted} // unplayed = pure muted grey (like WhatsApp)
        />
      ));
    }
    // Recording — each bar reads from the history array
    return Array.from({ length: BARS }, (_, i) => (
      <LiveBar key={i} i={i} history={history} head={head} tint={color.error} />
    ));
  }, [
    isProcessing,
    isPreview,
    peaks,
    history,
    head,
    player.progressSV,
    player.duration,
    color.muted,
    color.brand,
    color.error,
  ]);

  /* ── Thumb & Time ── */
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

  /* ── Render ────────────────────────────────────────────────── */
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
        /* ── Preview: Play/Pause + Waveform + Seek + Time ────────── */
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
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              boxShadow: shadows.soft,
              backgroundColor: color.brand,
            }}
          >
            {player.isPlaying ? (
              <Pause
                size={20}
                color={color.onBrand}
                fill={color.onBrand}
              />
            ) : (
              <Play
                size={20}
                color={color.onBrand}
                fill={color.onBrand}
                style={{ marginLeft: 3 }}
              />
            )}
          </Pressable>

          <GestureDetector gesture={pan}>
            <Box
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                height: 40,
                marginLeft: spacing.md,
                marginRight: spacing.sm,
              }}
              onLayout={(e) => {
                widthSV.value = e.nativeEvent.layout.width;
              }}
            >
              {bars}
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
          </GestureDetector>

          <Text
            variant="bodySmall"
            style={{ color: color.foreground, width: 40, textAlign: "right" }}
          >
            {player.isPlaying ? displayTime : fmtTime(player.duration)}
          </Text>
        </Box>
      ) : (
        /* ── Recording / Processing ────────────────────────── */
        <Box
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: spacing.sm,
          }}
        >
          {/* Left side: Timer & Dot */}
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
              {fmtTime(elapsedMs)}
            </Text>
          </Box>

          {/* Center: Live 50-bar waveform or Processing state */}
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
              <Box
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                  flex: 1,
                }}
              >
                {bars}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Animated.View>
  );
}
