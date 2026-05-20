import { Check } from 'lucide-react-native';
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
  animatedStyle?: any;
}

export function LanguageDropdown({
  visible,
  onClose,
  options,
  currentLang,
  oppositeLang,
  onSelect,
  animatedStyle,
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
            <ScrollView bounces={false}>
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
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownCard: {
    width: '80%',
    maxHeight: '50%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginVertical: 2,
    gap: 12,
  },
  flagIcon: {
    fontSize: 20,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Outfit-Medium',
  },
});
