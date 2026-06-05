import { Check, Lock } from 'lucide-react-native';
import React from 'react';
import { Modal } from 'react-native';
import Animated from 'react-native-reanimated';

import { Box, Text, Pressable, ScrollArea } from '@/components/ui';
import { shadows } from '@/constants';
import { FLAG_MAP, getLanguageName } from '@/constants/languages';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
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
      <Pressable
        onPress={onClose}
        feedback="none"
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: color.overlay,
        }}
      >
        <Animated.View
          style={[
            {
              width: '80%',
              maxHeight: '55%',
              borderRadius: borderRadius['2xl'],
              borderWidth: 1,
              padding: spacing.xs,
              ...shadows.softLg,
              backgroundColor: color.card,
              borderColor: color.border,
            },
            animatedStyle,
          ]}
        >
          {/* Header label */}
          <Box
            style={{
              paddingHorizontal: spacing.md,
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
            }}
          >
            <Text
              variant="caption"
              style={{
                textTransform: 'uppercase',
                color: color.muted,
              }}
            >
              Select Language
            </Text>
          </Box>

          <ScrollArea bounces={false}>
            {/* Locked 'Auto' row for free users */}
            {showAutoLocked && (
              <Box
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius.lg,
                  marginVertical: spacing.xs,
                  gap: spacing.sm,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  opacity: 0.65,
                  backgroundColor: color.surface,
                  borderColor: color.border,
                }}
              >
                <Text variant="body">🌐</Text>
                <Text
                  variant="bodySmall"
                  style={{
                    flex: 1,
                    color: color.muted,
                  }}
                >
                  Auto-detect
                </Text>
                <Box
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xs,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderRadius: borderRadius.md,
                    backgroundColor: color.surface,
                  }}
                >
                  <Lock size={10} color={color.secondary} strokeWidth={2.5} />
                  <Text
                    variant="caption"
                    style={{
                      color: color.secondary,
                    }}
                  >
                    Pro
                  </Text>
                </Box>
              </Box>
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
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      borderRadius: borderRadius.lg,
                      marginVertical: spacing.xs,
                      gap: spacing.sm,
                    },
                    isSelected && { backgroundColor: color.surface },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    variant="body"
                    style={[isOtherLang && { opacity: 0.35 }]}
                  >
                    {flag}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      flex: 1,
                      color: isOtherLang ? color.muted : color.foreground,
                    }}
                  >
                    {langName}
                    {isOtherLang ? '  ✕' : ''}
                  </Text>
                  {isSelected && (
                    <Check size={18} color={color.secondary} strokeWidth={3} />
                  )}
                </Pressable>
              );
            })}
          </ScrollArea>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
