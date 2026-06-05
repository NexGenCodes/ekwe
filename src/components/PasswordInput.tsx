/**
 * PasswordInput — Input with secure text + eye toggle.
 */
import { Eye, EyeOff } from "lucide-react-native";
import React, { forwardRef, useState } from "react";
import { TextInput } from "react-native";

import { Input, InputProps } from "@/components/Input";
import { Box, Pressable } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { borderRadius, opacity } from "@/constants/sizes";
import { useTheme } from "@/hooks";

export interface PasswordInputProps extends Omit<
  InputProps,
  "secureTextEntry"
> {
  showStrength?: boolean;
}

export const PasswordInput = forwardRef<TextInput, PasswordInputProps>(
  ({ showStrength = false, value = "", onChangeText, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const { color } = useTheme();

    const getStrength = (val: string): number => {
      let score = 0;
      if (!val) return 0;
      if (val.length >= 8) score += 1;
      if (/[A-Z]/.test(val)) score += 1;
      if (/[0-9]/.test(val)) score += 1;
      if (/[^A-Za-z0-9]/.test(val)) score += 1;
      return score;
    };

    const strength = getStrength(value);

    const getStrengthColor = (): string => {
      if (strength === 0) return color.border;
      if (strength === 1) return color.error;
      if (strength === 2) return color.warning;
      if (strength >= 3) return color.success;
      return color.border;
    };

    return (
      <Box style={{ position: "relative" }}>
        <Input
          ref={ref}
          secureTextEntry={!visible}
          style={{ paddingRight: spacing["4xl"] }}
          value={value}
          onChangeText={onChangeText}
          {...props}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          style={{
            position: "absolute",
            right: spacing.md,
            top: 0,
            height: 56,
            justifyContent: "center",
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          accessibilityState={{ selected: visible }}
        >
          {visible ? (
            <Eye size={20} color={color.muted} />
          ) : (
            <EyeOff size={20} color={color.muted} />
          )}
        </Pressable>

        {showStrength && value.length > 0 && (
          <Box
            style={{
              flexDirection: "row",
              gap: spacing.xs,
              marginTop: spacing.sm,
              paddingHorizontal: spacing.xs,
            }}
          >
            {[1, 2, 3, 4].map((level) => (
              <Box
                key={level}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: borderRadius.sm,
                  backgroundColor:
                    strength >= level ? getStrengthColor() : color.border,
                  opacity: strength >= level ? 1 : 0.5,
                }}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
