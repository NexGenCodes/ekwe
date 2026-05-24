import { Check, Lock } from 'lucide-react-native';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { FLAG_MAP, getLanguageName } from '@/constants/languages';
import { useTheme } from '@/hooks';

export interface LanguageDropdownProps {
  visible: boolean;
  onClose: () => void;
  options: string[];
  currentLang: string;
  oppositeLang?: string;
  onSelect: (code: string) => void;
  animatedStyle?: object;
  showAutoLocked?: boolean;
}

export function LanguageDropdown({
  visible,
  onClose,
  options,
  currentLang,
  oppositeLang,
  onSelect,
  animatedStyle,
  showAutoLocked = false,
}: LanguageDropdownProps): React.ReactElement | null {
  const { color } = useTheme();

  if (!visible && !animatedStyle) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <Animated.View
            style={[
              styles.dropdownCard,
              { backgroundColor: color.card, borderColor: color.border },
              animatedStyle,
            ]}
          >
            {/* Header label */}
            <View style={styles.cardHeader}>
              <Text style={[styles.cardHeaderText, { color: color.muted }]}>
                Select Language
              </Text>
            </View>

            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {/* Locked 'Auto' row for free users */}
              {showAutoLocked && (
                <View
                  style={[
                    styles.dropdownItem,
                    styles.lockedItem,
                    {
                      backgroundColor: color.surface,
                      borderColor: color.border,
                    },
                  ]}
                >
                  <Text style={styles.flagIcon}>🌐</Text>
                  <Text
                    style={[styles.dropdownItemText, { color: color.muted }]}
                  >
                    Auto-detect
                  </Text>
                  <View
                    style={[
                      styles.proBadge,
                      { backgroundColor: color.primary + '22' },
                    ]}
                  >
                    <Lock size={10} color={color.primary} strokeWidth={2.5} />
                    <Text
                      style={[styles.proBadgeText, { color: color.primary }]}
                    >
                      Pro
                    </Text>
                  </View>
                </View>
              )}

              {options.map((code) => {
                const isSelected = currentLang === code;
                const isOtherLang = code === oppositeLang && code !== 'auto';
                const langName = getLanguageName(code);
                const flag = code === 'auto' ? '🌐' : FLAG_MAP[code] || '🏳️';

                return (
                  <Pressable
                    key={code}
                    onPress={() => onSelect(code)}
                    style={({ pressed }) => [
                      styles.dropdownItem,
                      isSelected && { backgroundColor: color.surface },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.flagIcon,
                        isOtherLang && { opacity: 0.35 },
                      ]}
                    >
                      {flag}
                    </Text>
                    <Text
                      style={[
                        styles.dropdownItemText,
                        { color: isOtherLang ? color.muted : color.foreground },
                      ]}
                    >
                      {langName}
                      {isOtherLang ? '  ✕' : ''}
                    </Text>
                    {isSelected && (
                      <Check
                        size={18}
                        color={color.secondary}
                        strokeWidth={3}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownCard: {
    width: '80%',
    maxHeight: '55%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  cardHeaderText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginVertical: 1,
    gap: 10,
  },
  lockedItem: {
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.65,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  proBadgeText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  flagIcon: {
    fontSize: 18,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Outfit-Medium',
  },
});
