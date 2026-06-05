import React, { useState } from "react";
import { Dimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useAnimatedGestureHandler,
} from "react-native-reanimated";
import { PanGestureHandler } from "react-native-gesture-handler";
import { Mic, X, Copy, Globe } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";

import { Box, Text, Pressable, Icon } from "@/components/ui";
import { useTheme } from "@/hooks";
import { useAudioStream } from "@/hooks/audio/useAudioStream";
import { triggerHaptic } from "@/utils/haptics";
import { borderRadius, opacity, zIndex } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { palette } from "@/constants/colors";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export function LensOverlay() {
  const { color } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { isStreaming, transcript, startStream, stopStream } = useAudioStream();
  const [translatedText, setTranslatedText] = useState("");

  const translateX = useSharedValue(SCREEN_WIDTH - 80);
  const translateY = useSharedValue(SCREEN_HEIGHT / 2);

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startX = translateX.value;
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: (_) => {
      if (translateX.value < SCREEN_WIDTH / 2) {
        translateX.value = withSpring(20);
      } else {
        translateX.value = withSpring(SCREEN_WIDTH - 80);
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const handleCopy = async () => {
    await triggerHaptic();
    if (translatedText) {
      await Clipboard.setStringAsync(translatedText);
    }
  };

  const handleTranslate = async () => {
    await triggerHaptic();
    setTranslatedText("Simulated translation result from Lens API.");
  };

  if (!expanded) {
    return (
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View
          style={[
            {
              position: "absolute",
              width: 60,
              height: 60,
              borderRadius: borderRadius.full,
              justifyContent: "center",
              alignItems: "center",
              elevation: 8,
              shadowColor: palette.neutral950,
              shadowOpacity: 0.3,
              shadowRadius: 5,
              shadowOffset: { width: 0, height: 4 },
              zIndex: zIndex.modal,
              backgroundColor: color.primary,
            },
            animatedStyle,
          ]}
        >
          <Pressable
            onPress={async () => {
              await triggerHaptic();
              setExpanded(true);
            }}
            feedback="scale"
            style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}
          >
            <Icon icon={Mic} size="lg" color={color.onPrimary} />
          </Pressable>
        </Animated.View>
      </PanGestureHandler>
    );
  }

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 320,
          padding: spacing.lg,
          borderRadius: borderRadius.xl,
          borderWidth: 1,
          borderColor: color.border,
          elevation: 10,
          shadowColor: palette.neutral950,
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          zIndex: zIndex.modal,
          backgroundColor: color.card,
        },
        animatedStyle,
      ]}
    >
      <Box style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
        <Box style={{ flexDirection: "row", alignItems: "center" }}>
          <Box style={{ marginRight: spacing.sm }}>
            <Icon icon={Globe} size="sm" color={color.primary} />
          </Box>
          <Text variant="body" style={{ fontWeight: "bold" }}>
            Lens Translator
          </Text>
        </Box>
        <Pressable
          onPress={async () => {
            await triggerHaptic();
            setExpanded(false);
            stopStream();
          }}
          feedback="scale"
        >
          <Icon icon={X} size="sm" color={color.muted} />
        </Pressable>
      </Box>

      <Box style={{ minHeight: 80, marginBottom: spacing.md }}>
        <Text variant="bodySmall">
          {transcript || (isStreaming ? "Listening..." : "Tap Listen to transcribe speaker audio")}
        </Text>
        {translatedText ? (
          <Box style={{ marginTop: spacing.sm, padding: spacing.sm, backgroundColor: color.surface, borderRadius: borderRadius.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text variant="label" style={{ color: color.primary }}>
              {translatedText}
            </Text>
            <Pressable onPress={handleCopy} feedback="opacity" style={{ padding: spacing.xs }}>
              <Icon icon={Copy} size="sm" color={color.primary} />
            </Pressable>
          </Box>
        ) : null}
      </Box>

      <Box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Pressable
          style={[
            {
              flex: 1,
              paddingVertical: spacing.sm,
              borderRadius: borderRadius.md,
              alignItems: "center",
              marginHorizontal: spacing.xs,
              backgroundColor: isStreaming ? color.error : color.primary,
            },
          ]}
          onPress={async () => {
            await triggerHaptic();
            isStreaming ? stopStream() : startStream("auto");
          }}
        >
          <Text variant="body" style={{ color: color.onPrimary, fontWeight: "bold" }}>
            {isStreaming ? "Stop" : "Listen"}
          </Text>
        </Pressable>
        <Pressable
          style={[
            {
              flex: 1,
              paddingVertical: spacing.sm,
              borderRadius: borderRadius.md,
              alignItems: "center",
              marginHorizontal: spacing.xs,
              backgroundColor: color.secondary,
              opacity: transcript ? 1 : opacity.disabled,
            },
          ]}
          onPress={handleTranslate}
          disabled={!transcript && !translatedText}
        >
          <Text variant="body" style={{ color: color.onSecondary, fontWeight: "bold" }}>
            Translate
          </Text>
        </Pressable>
      </Box>
    </Animated.View>
  );
}
