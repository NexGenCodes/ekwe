import { FlashList } from '@shopify/flash-list';
import { Search, Star, X, Check } from 'lucide-react-native';
import React, { useMemo, useState, useCallback, memo } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';

import { LanguagePickerInlineProps } from './LanguagePickerInline.types';

import { getColor } from '@/constants/colors';
import { LANGUAGES, Language, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks/useTheme';

interface LanguageRowProps {
  item: Language;
  isSelected: boolean;
  isPinned: boolean;
  onToggleSelect: (code: string) => void;
  onTogglePin: (code: string) => void;
}

// Memoized row component for maximum performance
const LanguageRow = memo(
  ({
    item,
    isSelected,
    isPinned,
    onToggleSelect,
    onTogglePin,
  }: LanguageRowProps): React.ReactElement => {
    const { colorScheme } = useTheme();
    const isDark = colorScheme === 'dark';

    const mutedColor = getColor('muted', isDark);
    const primaryColor = getColor('primary', isDark);

    return (
      <Pressable
        onPress={() => onToggleSelect(item.code)}
        testID={`lang-row-${item.code}`}
        className="h-[52px] flex-row items-center px-4 bg-background dark:bg-background-dark active:opacity-60"
      >
        <View className="flex-1 flex-row items-center">
          <Text className="text-xl mr-3">{FLAG_MAP[item.code] || '🌐'}</Text>
          <View>
            <Text className="text-base font-body text-zinc-950 dark:text-zinc-50">
              {item.englishName}
            </Text>
            <Text className="text-xs mt-0.5 font-body text-zinc-500 dark:text-zinc-400">
              {item.nativeName}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center">
          <Pressable
            onPress={() => onTogglePin(item.code)}
            testID={`pin-button-${item.code}`}
            hitSlop={8}
            className="p-2 active:opacity-60"
          >
            <Star
              size={20}
              color={isPinned ? primaryColor : mutedColor}
              fill={isPinned ? primaryColor : 'transparent'}
            />
          </Pressable>

          <View
            className={`w-[22px] h-[22px] rounded-full ml-3 items-center justify-center ${
              isSelected
                ? 'border-0 bg-primary'
                : 'border-[1.5px] border-zinc-300 dark:border-zinc-700 bg-transparent'
            }`}
          >
            {isSelected && (
              <Check
                size={12}
                color={getColor('onPrimary', isDark)}
                strokeWidth={3}
              />
            )}
          </View>
        </View>
      </Pressable>
    );
  },
);

// Flat list item type to handle both row and headers in FlashList
type ListItem =
  | { type: 'header'; title: string }
  | { type: 'row'; data: Language; isPinned: boolean };

export const LanguagePickerInline = ({
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
}: LanguagePickerInlineProps): React.ReactElement => {
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');

  const mutedColor = getColor('muted', isDark);

  // Memoized filter logic
  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === '') return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  // Flattened data for FlashList compatibility with high performance
  const flatData = useMemo(() => {
    const pinned = filteredLanguages.filter((l) =>
      pinnedLanguages.includes(l.code),
    );
    const others = filteredLanguages.filter(
      (l) => !pinnedLanguages.includes(l.code),
    );

    const result: ListItem[] = [];
    if (pinned.length > 0) {
      result.push({ type: 'header', title: 'PINNED' });
      pinned.forEach((l) =>
        result.push({ type: 'row', data: l, isPinned: true }),
      );
    }

    result.push({
      type: 'header',
      title: searchQuery ? 'RESULTS' : 'ALL LANGUAGES',
    });
    others.forEach((l) =>
      result.push({ type: 'row', data: l, isPinned: false }),
    );

    return result;
  }, [filteredLanguages, pinnedLanguages, searchQuery]);

  const handleToggleSelection = useCallback(
    (code: string): void => {
      const isSelected = selectedLanguages.includes(code);
      if (!isSelected && selectedLanguages.length >= 2) return; // Limit to 2 as requested in conversation history

      const next = isSelected
        ? selectedLanguages.filter((c) => c !== code)
        : [...selectedLanguages, code];
      onSelectionChange(next, pinnedLanguages);
    },
    [selectedLanguages, pinnedLanguages, onSelectionChange],
  );

  const handleTogglePin = useCallback(
    (code: string): void => {
      const next = pinnedLanguages.includes(code)
        ? pinnedLanguages.filter((c) => c !== code)
        : [...pinnedLanguages, code];
      onSelectionChange(selectedLanguages, next);
    },
    [selectedLanguages, pinnedLanguages, onSelectionChange],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <View className="px-4 py-3 bg-card dark:bg-card-dark border-b-[0.5px] border-zinc-200 dark:border-zinc-800">
            <Text className="font-semibold tracking-[0.5px] text-zinc-500 dark:text-zinc-400 text-xs">
              {item.title}
            </Text>
          </View>
        );
      }

      return (
        <LanguageRow
          item={item.data}
          isSelected={selectedLanguages.includes(item.data.code)}
          isPinned={item.isPinned}
          onToggleSelect={handleToggleSelection}
          onTogglePin={handleTogglePin}
        />
      );
    },
    [selectedLanguages, handleToggleSelection, handleTogglePin],
  );

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <View className="px-4 pb-2 z-10">
        <View className="h-11 border-[0.5px] border-zinc-200 dark:border-zinc-800 rounded-xl flex-row items-center px-3 bg-card dark:bg-card-dark">
          <Search size={18} color={mutedColor} style={{ marginRight: 8 }} />
          <TextInput
            className="flex-1 h-11 text-base font-body text-zinc-950 dark:text-zinc-50"
            placeholder="Search languages"
            placeholderTextColor={mutedColor}
            value={searchQuery}
            autoCorrect={false}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={16} color={mutedColor} />
            </Pressable>
          )}
        </View>
      </View>

      <FlashList
        data={flatData}
        renderItem={renderItem}
        keyExtractor={(item, _index) =>
          item.type === 'header' ? `h-${item.title}` : `r-${item.data.code}`
        }
        getItemType={(item) => item.type}
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
};
