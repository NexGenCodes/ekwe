import React from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Copy, Volume2, Check } from 'lucide-react-native';

import { useTheme } from '@/hooks';

interface TargetOutputCardProps {
  translation: string | null;
  isTranslating: boolean;
  onCopy?: () => void;
  onSpeak?: () => void;
  copied?: boolean;
}

export function TargetOutputCard({
  translation,
  isTranslating,
  onCopy,
  onSpeak,
  copied = false,
}: TargetOutputCardProps): React.ReactElement {
  const { color } = useTheme();

  if (!translation && !isTranslating) {
    return (
      <View className="bg-background/50 dark:bg-background/50 border border-border/50 dark:border-border/50 rounded-3xl p-5 border-dashed items-center justify-center min-h-[160px]">
        <Text className="font-body text-sm text-muted dark:text-muted text-center">
          Translation will appear here
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-primary/10 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-3xl p-5 mb-8 shadow-sm">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="font-bodyMed text-xs uppercase tracking-widest text-primary dark:text-primary">
          Translated
        </Text>
        {isTranslating && <ActivityIndicator size="small" color={color.primary} />}
      </View>

      <Text className="font-bodyMed text-2xl text-foreground dark:text-foreground min-h-[100px]">
        {translation || ''}
      </Text>

      {translation && !isTranslating && (
        <View className="flex-row justify-end mt-4 gap-x-2">
          {onSpeak && (
            <Pressable
              onPress={onSpeak}
              className="w-12 h-12 rounded-full bg-card dark:bg-card items-center justify-center active:scale-95 border border-border dark:border-border"
              hitSlop={8}
            >
              <Volume2 size={18} color={color.foreground} />
            </Pressable>
          )}
          {onCopy && (
            <Pressable
              onPress={onCopy}
              className="w-12 h-12 rounded-full bg-card dark:bg-card items-center justify-center active:scale-95 border border-border dark:border-border"
              hitSlop={8}
            >
              {copied ? (
                <Check size={18} color={color.success} />
              ) : (
                <Copy size={18} color={color.foreground} />
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
