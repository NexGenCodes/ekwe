import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface EkweButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
}

export const EkweButton: React.FC<EkweButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  style,
}) => {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.label, !isPrimary && styles.secondaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: lightTokens.space[3],
    paddingHorizontal: lightTokens.space[6],
    borderRadius: lightTokens.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: lightTokens.color.brand.navy,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: lightTokens.color.border.strong,
  },
  pressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.9,
  },
  label: {
    fontFamily: lightTokens.font.family.bodyMed,
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.inverse,
  },
  secondaryLabel: {
    color: lightTokens.color.text.primary,
  },
});
