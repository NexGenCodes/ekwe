import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { borderRadius, touchTarget } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";

interface OtpInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  disabled?: boolean;
  error?: string;
  autoFocus?: boolean;
  shakeSignal?: number;
}

const DIGIT_COUNT = 6;

const OtpDigitBox = memo(function OtpDigitBox({
  digit,
  isFocused,
  hasError,
  borderColor,
  secondaryColor,
  errorColor,
  cardColor,
  foregroundColor,
}: {
  digit: string;
  isFocused: boolean;
  hasError: boolean;
  borderColor: string;
  secondaryColor: string;
  errorColor: string;
  cardColor: string;
  foregroundColor: string;
}) {
  const focusProgress = useSharedValue(isFocused ? 1 : 0);

  React.useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, { duration: 150 });
  }, [isFocused, focusProgress]);

  const animatedBorder = useAnimatedStyle(() => {
    if (hasError) return { borderColor: errorColor };
    return {
      borderColor: interpolateColor(
        focusProgress.value,
        [0, 1],
        [borderColor, secondaryColor],
      ),
    };
  });

  return (
    <Animated.View
      style={[
        {
          flex: 1,
          maxWidth: 56,
          aspectRatio: 48 / 56,
          minHeight: touchTarget.minimum,
          borderRadius: borderRadius.lg,
          backgroundColor: cardColor,
          borderWidth: 2,
          alignItems: "center",
          justifyContent: "center",
        },
        animatedBorder,
      ]}
    >
      {digit ? (
        <Animated.Text
          style={{
            ...typography.heading2,
            color: foregroundColor,
            textAlign: "center",
          }}
        >
          {digit}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
});

export const OtpInput = memo(function OtpInput({
  value,
  onChangeText,
  onSubmitEditing,
  disabled = false,
  error,
  autoFocus = false,
  shakeSignal = 0,
}: OtpInputProps): React.ReactElement {
  const { color } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(autoFocus);
  const shakeX = useSharedValue(0);
  const lastShake = useRef(0);

  useEffect(() => {
    if (shakeSignal === 0 || shakeSignal === lastShake.current) return;
    lastShake.current = shakeSignal;
    shakeX.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withTiming(10, { duration: 60 }),
      withTiming(-7, { duration: 60 }),
      withTiming(7, { duration: 60 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeSignal, shakeX]);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const digits = value
    .split("")
    .concat(Array(DIGIT_COUNT - value.length).fill(""));

  const handleChange = useCallback(
    (text: string) => {
      if (!/^\d*$/.test(text)) return;
      const newVal = text.slice(0, DIGIT_COUNT);
      onChangeText(newVal);
      if (newVal.length === DIGIT_COUNT && onSubmitEditing) {
        onSubmitEditing();
      }
    },
    [onChangeText, onSubmitEditing],
  );

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  return (
    <Box style={{ alignSelf: "stretch" }}>
      <Animated.View style={shakeStyle}>
        {}
        <Box
          pointerEvents="none"
          style={{
            flexDirection: "row",
            gap: spacing.xs,
            justifyContent: "center",
          }}
        >
          {digits.map((digit, index) => {
            const isCurrentFocused =
              isFocused &&
              (index === value.length ||
                (index === DIGIT_COUNT - 1 && value.length === DIGIT_COUNT));

            return (
              <OtpDigitBox
                key={index}
                digit={digit}
                isFocused={isCurrentFocused}
                hasError={!!error}
                borderColor={color.border}
                secondaryColor={color.brand}
                errorColor={color.error}
                cardColor={color.card}
                foregroundColor={color.foreground}
              />
            );
          })}
        </Box>
      </Animated.View>

      {}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={DIGIT_COUNT}
        editable={!disabled}
        autoFocus={autoFocus}
        onFocus={handleFocus}
        onBlur={handleBlur}
        caretHidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          color: "transparent",
          opacity: 0.01,
          backgroundColor: "transparent",
        }}
        accessibilityLabel="Enter verification code"
      />
    </Box>
  );
});
