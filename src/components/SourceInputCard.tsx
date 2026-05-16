import React from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { X, Mic } from 'lucide-react-native';

import { useTheme } from '@/hooks';

interface SourceInputCardProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onMicPress?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SourceInputCard({
  value,
  onChangeText,
  onClear,
  onMicPress,
  placeholder = 'Type to translate or tap mic...',
  autoFocus = false,
}: SourceInputCardProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <View className="bg-card dark:bg-card border border-border dark:border-border rounded-3xl p-5 mb-4 shadow-sm">
      <View className="flex-row justify-between items-center mb-2">
        <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted dark:text-muted">
          Source Text
        </Text>
        {value.length > 0 && (
          <Pressable
            onPress={onClear}
            className="p-1 rounded-full active:bg-border/50"
            hitSlop={12}
          >
            <X size={16} color={color.muted} />
          </Pressable>
        )}
      </View>

      <TextInput
        className="font-bodyMed text-2xl text-foreground dark:text-foreground min-h-[120px] text-left"
        style={{ textAlignVertical: 'top' }}
        multiline
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        selectionColor={color.primary}
      />

      <View className="flex-row justify-end mt-2">
        <Pressable
          onPress={onMicPress}
          className="w-12 h-12 rounded-full bg-primary dark:bg-primary items-center justify-center active:scale-95 shadow-sm"
          style={{ transitionDuration: '150ms' } as object}
        >
          <Mic size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}
