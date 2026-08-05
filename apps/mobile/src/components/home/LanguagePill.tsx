import ChevronDown from "lucide-react-native/icons/chevron-down";
import React, { useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from "react-native-reanimated";

import { LanguageFlag } from "@/components/language";
import { Text, Pressable } from "@/components/ui";
import { getLanguageAbbreviation } from "@/constants/languages";
import { triggerHaptic } from "@/utils";
import { useTokens } from "@/hooks/ui";

export interface LanguagePillProps {
  langCode: string;
  detectedLanguage?: string | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function LanguagePill({
  langCode,
  detectedLanguage,
  onPress,
  style,
}: LanguagePillProps): React.ReactElement {
  const { color, spacing, borderRadius } = useTokens();
  const scale = useSharedValue(1);

  const displayCode =
    langCode === "auto" && detectedLanguage ? detectedLanguage : langCode;

  const prevDetectedRef = React.useRef(detectedLanguage);

  useEffect(() => {
    if (detectedLanguage && detectedLanguage !== prevDetectedRef.current) {
      scale.value = withSequence(
        withSpring(1.08, { damping: 8, stiffness: 200 }),
        withSpring(1, { damping: 12, stiffness: 200 }),
      );
      triggerHaptic();
    }
    prevDetectedRef.current = detectedLanguage;
  }, [detectedLanguage, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        feedback="scale"
        accessibilityLabel={
          langCode === "auto" && detectedLanguage
            ? `Source language detected as ${getLanguageAbbreviation(detectedLanguage)}. Tap to change.`
            : langCode === "auto"
              ? "Auto-detect source language. Tap to change."
              : `${getLanguageAbbreviation(langCode)}. Tap to change.`
        }
        style={[
          {
            flex: 1,
            flexDirection: "row",
            gap: spacing.sm,
            height: 44,
            borderRadius: borderRadius["2xl"],
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.md,
            backgroundColor: color.card,
            borderColor: color.border,
          },
          style,
        ]}
      >
        <LanguageFlag code={displayCode} size="sm" />
        <Text
          variant="bodySmall"
          style={{
            marginRight: spacing.xs,
            color: !displayCode ? color.muted : color.foreground,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {!displayCode ? "Select" : getLanguageAbbreviation(displayCode)}
        </Text>
        <ChevronDown size={14} color={color.muted} strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}
