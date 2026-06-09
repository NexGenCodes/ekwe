import React, { memo, useCallback, useRef, useState } from "react";
import { Pressable, TextInput } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";

import { Box } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
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
          width: 48,
          height: 56,
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
          entering={FadeIn.duration(100)}
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
}: OtpInputProps): React.ReactElement {
  const { color } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(autoFocus);

  const digits = value
    .split("")
    .concat(Array(DIGIT_COUNT - value.length).fill(""));

  const handlePress = useCallback(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

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
    <Box>
      <Pressable onPress={handlePress}>
        <Box
          style={{
            flexDirection: "row",
            gap: spacing.sm,
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
                secondaryColor={color.secondary}
                errorColor={color.error}
                cardColor={color.card}
                foregroundColor={color.foreground}
              />
            );
          })}
        </Box>
      </Pressable>

      {/* Hidden input — native autofill + paste */}
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
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        accessibilityLabel="Enter verification code"
      />
    </Box>
  );
});
