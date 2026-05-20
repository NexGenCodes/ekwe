import {
  Smile,
  Ghost,
  Sparkles,
  Heart,
  Star,
  Zap,
  Coffee,
  Music,
  Rocket,
  User,
  X,
} from 'lucide-react-native';
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';

import { useTheme } from '@/hooks';

export const AVATAR_ICONS = [
  { name: 'Smile', icon: Smile, color: '#F59E0B' }, // Amber
  { name: 'Ghost', icon: Ghost, color: '#8B5CF6' }, // Purple
  { name: 'Sparkles', icon: Sparkles, color: '#10B981' }, // Emerald
  { name: 'Heart', icon: Heart, color: '#EF4444' }, // Red
  { name: 'Star', icon: Star, color: '#EAB308' }, // Yellow
  { name: 'Zap', icon: Zap, color: '#3B82F6' }, // Blue
  { name: 'Coffee', icon: Coffee, color: '#A8A29E' }, // Stone
  { name: 'Music', icon: Music, color: '#EC4899' }, // Pink
  { name: 'Rocket', icon: Rocket, color: '#06B6D4' }, // Cyan
];

interface AvatarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  currentIcon?: string | null;
}

export function AvatarPickerModal({
  visible,
  onClose,
  onSelect,
  currentIcon,
}: AvatarPickerModalProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: color.background, borderColor: color.border },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: color.foreground }]}>
              Choose an Avatar
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Close avatar picker"
            >
              <X size={24} color={color.muted} />
            </Pressable>
          </View>

          <View style={styles.iconGrid}>
            {AVATAR_ICONS.map((item) => {
              const isSelected = currentIcon === item.name;
              return (
                <Pressable
                  key={item.name}
                  style={({ pressed }) => [
                    styles.iconGridItem,
                    {
                      backgroundColor: color.card,
                      borderColor: isSelected ? item.color : color.border,
                    },
                    pressed && {
                      backgroundColor: `${item.color}1A`,
                      transform: [{ scale: 0.95 }],
                    },
                  ]}
                  onPress={() => onSelect(item.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${item.name} avatar`}
                  accessibilityState={isSelected ? { selected: true } : undefined}
                >
                  <item.icon size={32} color={item.color} />
                </Pressable>
              );
            })}

            {/* Default Option (Google / Initials) */}
            <Pressable
              style={({ pressed }) => [
                styles.iconGridItem,
                {
                  backgroundColor: color.card,
                  borderColor: !currentIcon ? color.primary : color.border,
                },
                pressed && {
                  backgroundColor: `${color.primary}1A`,
                  transform: [{ scale: 0.95 }],
                },
              ]}
              onPress={() => onSelect('')}
              accessibilityRole="button"
              accessibilityLabel="Use default avatar"
              accessibilityState={!currentIcon ? { selected: true } : undefined}
            >
              <User
                size={32}
                color={!currentIcon ? color.primary : color.foreground}
              />
              <Text
                style={{
                  fontSize: 10,
                  color: !currentIcon ? color.primary : color.muted,
                  marginTop: 4,
                  fontFamily: 'Outfit-Medium',
                }}
              >
                Auto
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 48,
    borderTopWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 20,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  iconGridItem: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
