import React, { useState } from "react";
import { StyleSheet, View, Text, Pressable, Dimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useAnimatedGestureHandler,
} from "react-native-reanimated";
import { PanGestureHandler } from "react-native-gesture-handler";
import { Mic, X, Copy, Globe } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";

import { useTheme } from "@/hooks";
import { useAudioStream } from "@/hooks/audio/useAudioStream";
import { triggerHaptic } from "@/utils/haptics";

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
      // Snap to edges
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
    // Here we'd call the real translation service using the 'transcript' state
    setTranslatedText("Simulated translation result from Lens API.");
  };

  if (!expanded) {
    return (
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View
          style={[styles.bubble, animatedStyle, { backgroundColor: color.primary }]}
        >
          <Pressable
            onPress={async () => {
              await triggerHaptic();
              setExpanded(true);
            }}
            style={styles.bubbleInner}
          >
            <Mic color="white" size={28} />
          </Pressable>
        </Animated.View>
      </PanGestureHandler>
    );
  }

  return (
    <Animated.View
      style={[
        styles.panel,
        animatedStyle,
        { backgroundColor: color.card, borderColor: color.border },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Globe color={color.primary} size={20} style={{ marginRight: 8 }} />
          <Text style={{ color: color.text, fontWeight: "bold", fontSize: 16 }}>
            Lens Translator
          </Text>
        </View>
        <Pressable
          onPress={async () => {
            await triggerHaptic();
            setExpanded(false);
            stopStream();
          }}
        >
          <X color={color.muted} size={24} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={{ color: color.text, fontSize: 15 }}>
          {transcript || (isStreaming ? "Listening..." : "Tap Listen to transcribe speaker audio")}
        </Text>
        {translatedText ? (
          <View style={styles.translationBox}>
            <Text style={{ color: color.primary, fontSize: 15, fontWeight: "500" }}>
              {translatedText}
            </Text>
            <Pressable onPress={handleCopy} style={styles.copyBtn}>
              <Copy color={color.primary} size={16} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[
            styles.button,
            { backgroundColor: isStreaming ? color.error : color.primary },
          ]}
          onPress={async () => {
            await triggerHaptic();
            isStreaming ? stopStream() : startStream("auto");
          }}
        >
          <Text style={{ color: "white", fontWeight: "bold" }}>
            {isStreaming ? "Stop" : "Listen"}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            { backgroundColor: color.secondary, opacity: transcript ? 1 : 0.5 },
          ]}
          onPress={handleTranslate}
          disabled={!transcript && !translatedText} // Remove this block later if we allow empty triggers
        >
          <Text style={{ color: color.onSecondary, fontWeight: "bold" }}>
            Translate
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 9999,
  },
  bubbleInner: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  panel: {
    position: "absolute",
    width: 320,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    zIndex: 9999,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  content: {
    minHeight: 80,
    marginBottom: 16,
  },
  translationBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  copyBtn: {
    padding: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginHorizontal: 6,
  },
});
