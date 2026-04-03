import * as Haptics from 'expo-haptics';
import { Moon, Sun } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, View, Text } from 'react-native';
import { useTheme } from 'src/hooks/useTheme';

import { ThemeTogglerProps } from './ThemeToggler.types';

export const ThemeToggler = ({
  style,
  accessibilityLabel,
  showLabels = false,
}: ThemeTogglerProps): React.ReactElement => {
  const { tokens, id, toggleTheme } = useTheme();
  const isDark = id === 'dark';

  const handlePress = (): void => {
    toggleTheme();
    Haptics.selectionAsync();
  };

  const indicatorStyle = {
    left: isDark ? 34 : 2,
    backgroundColor: tokens.color.background.primary,
  };

  const containerStyle = [
    styles.container,
    {
      backgroundColor: tokens.color.background.tertiary,
      borderColor: tokens.color.border.default,
    },
    style,
  ];

  return (
    <Pressable
      onPress={handlePress}
      style={containerStyle}
      accessibilityRole="switch"
      accessibilityLabel={
        accessibilityLabel || `Switch to ${isDark ? 'light' : 'dark'} mode`
      }
      accessibilityState={{ checked: isDark }}
    >
      <View style={[styles.indicator, indicatorStyle]} />
      <View style={styles.iconWrapper}>
        <Sun
          size={16}
          color={!isDark ? tokens.color.brand.core : tokens.color.text.tertiary}
          strokeWidth={2.5}
        />
      </View>
      <View style={styles.iconWrapper}>
        <Moon
          size={16}
          color={isDark ? tokens.color.brand.core : tokens.color.text.tertiary}
          strokeWidth={2.5}
        />
      </View>
      {showLabels && (
        <Text
          style={[
            styles.label,
            {
              color: tokens.color.text.primary,
              fontFamily: tokens.font.family.bodyMed,
            },
          ]}
        >
          {isDark ? 'Dark' : 'Light'}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 68,
    height: 36,
    borderRadius: 18,
    padding: 2,
    borderWidth: 1,
    borderCurve: 'continuous',
    position: 'relative',
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    zIndex: 0,
  },
  iconWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  label: {
    position: 'absolute',
    right: -40,
    fontSize: 12,
  },
});
