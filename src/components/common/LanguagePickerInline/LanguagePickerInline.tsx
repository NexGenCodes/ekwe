import { Search, Star, X, Check } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, SectionList } from 'react-native';
import { getColor } from 'src/constants/colors';
import { LANGUAGES, Language, FLAG_MAP } from 'src/constants/languages';

import { LanguagePickerInlineProps } from './LanguagePickerInline.types';

interface LanguageRowProps {
  item: Language;
  isSelected: boolean;
  isPinned: boolean;
  onToggleSelect: () => void;
  onTogglePin: () => void;
}

const matches = (val: boolean): boolean => val;

const LanguageRow = ({
  item,
  isSelected,
  isPinned,
  onToggleSelect,
  onTogglePin,
}: LanguageRowProps): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const mutedColor = getColor('muted', isDark);
  const primaryColor = getColor('primary', isDark);

  return (
    <Pressable
      onPress={onToggleSelect}
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
          onPress={onTogglePin}
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
            matches(isSelected)
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
};

export const LanguagePickerInline = ({
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
}: LanguagePickerInlineProps): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');

  const mutedColor = getColor('muted', isDark);

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === '') return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const sections = useMemo(() => {
    const pinned = filteredLanguages.filter((l) =>
      pinnedLanguages.includes(l.code),
    );
    const others = filteredLanguages.filter(
      (l) => !pinnedLanguages.includes(l.code),
    );

    const result = [];
    if (pinned.length > 0) {
      result.push({ title: 'PINNED', data: pinned });
    }
    result.push({
      title: searchQuery ? 'RESULTS' : 'ALL LANGUAGES',
      data: others,
    });

    return result;
  }, [filteredLanguages, pinnedLanguages, searchQuery]);

  const toggleSelection = (code: string): void => {
    const isSelected = selectedLanguages.includes(code);
    if (!isSelected && selectedLanguages.length >= 4) return;

    const next = isSelected
      ? selectedLanguages.filter((c) => c !== code)
      : [...selectedLanguages, code];
    onSelectionChange(next, pinnedLanguages);
  };

  const togglePin = (code: string): void => {
    const next = pinnedLanguages.includes(code)
      ? pinnedLanguages.filter((c) => c !== code)
      : [...pinnedLanguages, code];
    onSelectionChange(selectedLanguages, next);
  };

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
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={16} color={mutedColor} />
            </Pressable>
          )}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item: Language) => item.code}
        renderItem={({ item, section }): React.ReactElement => (
          <LanguageRow
            item={item}
            isSelected={selectedLanguages.includes(item.code)}
            isPinned={section.title === 'PINNED'}
            onToggleSelect={() => toggleSelection(item.code)}
            onTogglePin={() => togglePin(item.code)}
          />
        )}
        renderSectionHeader={({ section: { title } }): React.ReactElement => (
          <View className="px-4 py-3 bg-card dark:bg-card-dark border-b-[0.5px] border-zinc-200 dark:border-zinc-800">
            <Text className="font-semibold tracking-[0.5px] text-zinc-500 dark:text-zinc-400 text-xs">
              {title}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
};
