import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';

interface ThemeTogglerProps {
  isDark: boolean;
  onToggle: () => void;
}

export const ThemeToggler: React.FC<ThemeTogglerProps> = ({
  isDark,
  onToggle,
}) => {
  return (
    <Pressable onPress={onToggle} style={styles.container}>
      <Text style={styles.icon}>{isDark ? '☀️' : '🌙'}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: lightTokens.radius.full,
  },
  icon: {
    fontSize: 24,
  },
});
