import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronDown, ArrowDownUp } from 'lucide-react-native';

import { getLanguageName, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';

interface LanguageSelectorRowProps {
  sourceLang: string;
  targetLang: string;
  detectedLang?: string;
  onSwap: () => void;
  onOpenPicker: (mode: 'source' | 'target') => void;
}

export function LanguageSelectorRow({
  sourceLang,
  targetLang,
  detectedLang = 'und',
  onSwap,
  onOpenPicker,
}: LanguageSelectorRowProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <View className="flex-row items-center justify-between mb-6 px-1">
      {/* Source Language */}
      <Pressable
        onPress={() => onOpenPicker('source')}
        className="flex-1 flex-row items-center bg-card dark:bg-card border border-border dark:border-border px-4 py-3 min-h-[48px] rounded-[24px] active:scale-95"
        style={{ transitionDuration: '150ms' } as object}
      >
        <Text className="font-bodyMed text-sm text-foreground dark:text-foreground flex-1" numberOfLines={1}>
          {detectedLang !== 'und' && sourceLang === detectedLang
            ? 'DETECTED · '
            : ''}
          {getLanguageName(sourceLang)} {FLAG_MAP[sourceLang] || ''}
        </Text>
        <ChevronDown size={16} color={color.muted} />
      </Pressable>

      {/* Swap Button */}
      <Pressable
        onPress={onSwap}
        className="w-12 h-12 mx-2 items-center justify-center rounded-full bg-card dark:bg-card border border-border dark:border-border active:scale-95"
        style={{ transitionDuration: '150ms' } as object}
        hitSlop={12}
      >
        <ArrowDownUp size={18} color={color.muted} />
      </Pressable>

      {/* Target Language */}
      <Pressable
        onPress={() => onOpenPicker('target')}
        className="flex-1 flex-row items-center bg-card dark:bg-card border border-border dark:border-border px-4 py-3 min-h-[48px] rounded-[24px] active:scale-95"
        style={{ transitionDuration: '150ms' } as object}
      >
        <Text className="font-bodyMed text-sm text-foreground dark:text-foreground flex-1" numberOfLines={1}>
          {getLanguageName(targetLang)} {FLAG_MAP[targetLang] || ''}
        </Text>
        <ChevronDown size={16} color={color.muted} />
      </Pressable>
    </View>
  );
}
