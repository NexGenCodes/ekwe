import * as Clipboard from "expo-clipboard";
import { Mic, X, Copy, Globe } from "lucide-react-native";
import React, { useState } from "react";
import { Dimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { Box, Text, Pressable, Icon } from "@/components/ui";
import { palette } from "@/constants/colors";
import { borderRadius, opacity, zIndex } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
// Removed useAudioStream import due to deletion (BUG-06)
const useAudioStream = (): {
  isStreaming: boolean;
  transcript: string;
  startStream: (_mode: string) => void;
  stopStream: () => void;
} => ({
  isStreaming: false,
  transcript: "",
  startStream: (_mode: string): void => {},
  stopStream: (): void => {},
});
import { triggerHaptic } from "@/utils/haptics";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export function LensOverlay(): React.ReactElement {
  const { color } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { isStreaming, transcript, startStream, stopStream } = useAudioStream();
  const [translatedText, setTranslatedText] = useState("");

  const translateX = useSharedValue(SCREEN_WIDTH - 80);
  const translateY = useSharedValue(SCREEN_HEIGHT / 2);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      "worklet";
    })
    .onUpdate((e) => {
      translateX.value += e.translationX;
      translateY.value += e.translationY;
    })
    .onEnd(() => {
      if (translateX.value < SCREEN_WIDTH / 2) {
        translateX.value = withSpring(20);
      } else {
        translateX.value = withSpring(SCREEN_WIDTH - 80);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const handleCopy = async (): Promise<void> => {
    await triggerHaptic();
    if (translatedText) {
      await Clipboard.setStringAsync(translatedText);
    }
  };

  const handleTranslate = async (): Promise<void> => {
    await triggerHaptic();
    setTranslatedText("Simulated translation result from Lens API.");
  };

  if (!expanded) {
    return (
      <GestureDetector gesture={panGesture}>
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
              backgroundColor: color.foreground,
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
            style={{
              width: "100%",
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Icon icon={Mic} size="lg" color={color.onBrand} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
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
      <Box
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: spacing.md,
        }}
      >
        <Box style={{ flexDirection: "row", alignItems: "center" }}>
          <Box style={{ marginRight: spacing.sm }}>
            <Icon icon={Globe} size="sm" color={color.foreground} />
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
          {transcript ||
            (isStreaming
              ? "Listening..."
              : "Tap Listen to transcribe speaker audio")}
        </Text>
        {translatedText ? (
          <Box
            style={{
              marginTop: spacing.sm,
              padding: spacing.sm,
              backgroundColor: color.surface,
              borderRadius: borderRadius.md,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text variant="label" style={{ color: color.foreground }}>
              {translatedText}
            </Text>
            <Pressable
              onPress={handleCopy}
              feedback="opacity"
              style={{ padding: spacing.xs }}
            >
              <Icon icon={Copy} size="sm" color={color.foreground} />
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
              backgroundColor: isStreaming ? color.error : color.foreground,
            },
          ]}
          onPress={async () => {
            await triggerHaptic();
            if (isStreaming) {
              stopStream();
            } else {
              startStream("auto");
            }
          }}
        >
          <Text
            variant="body"
            style={{ color: color.onBrand, fontWeight: "bold" }}
          >
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
              backgroundColor: color.brand,
              opacity: transcript ? 1 : opacity.disabled,
            },
          ]}
          onPress={handleTranslate}
          disabled={!transcript && !translatedText}
        >
          <Text
            variant="body"
            style={{ color: color.onBrand, fontWeight: "bold" }}
          >
            Translate
          </Text>
        </Pressable>
      </Box>
    </Animated.View>
  );
}
