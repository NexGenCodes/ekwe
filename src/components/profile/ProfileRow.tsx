import { Image as ExpoImage } from 'expo-image';
import { ChevronRight, LucideIcon } from 'lucide-react-native';
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks';

export interface ProfileRowProps {
  icon: LucideIcon;
  sfIcon?: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  hasDivider?: boolean;
  trailing?: React.ReactNode;
  accentColor?: string; // defaults to iconColor for bg tint
}

export function ProfileRow({
  icon: Icon,
  sfIcon,
  iconColor,
  title,
  subtitle,
  onPress,
  hasDivider = false,
  trailing,
  accentColor,
}: ProfileRowProps): React.JSX.Element {
  const { color } = useTheme();
  const bgTint = `${accentColor ?? iconColor}1A`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        hasDivider && {
          borderBottomColor: color.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: bgTint, transform: [{ scale: 0.98 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      <View style={styles.rowContent}>
        <View style={[styles.rowIconContainer, { backgroundColor: bgTint }]}>
          {process.env.EXPO_OS === 'ios' && sfIcon ? (
            <ExpoImage
              source={`sf:${sfIcon}`}
              style={styles.sfIcon}
              tintColor={iconColor}
            />
          ) : (
            <Icon size={20} color={iconColor} />
          )}
        </View>
        <View style={styles.rowTextContainer}>
          <Text
            style={[
              styles.rowTitle,
              {
                color:
                  iconColor === color.error ? color.error : color.foreground,
              },
            ]}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              style={[
                styles.rowSubtitle,
                {
                  color: iconColor === color.error ? color.error : color.muted,
                  opacity: iconColor === color.error ? 0.8 : 1,
                },
              ]}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      {trailing ??
        (process.env.EXPO_OS === 'ios' ? (
          <ExpoImage
            source="sf:chevron.right"
            style={styles.chevron}
            tintColor={color.muted}
          />
        ) : (
          <ChevronRight size={20} color={color.muted} />
        ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextContainer: { marginLeft: 16, flex: 1 },
  rowTitle: { fontFamily: 'Outfit-Medium', fontSize: 16 },
  rowSubtitle: { fontFamily: 'Outfit-Regular', fontSize: 14, marginTop: 4 },
  sfIcon: { width: 20, height: 20 },
  chevron: { width: 14, height: 14, marginRight: 4 },
});
