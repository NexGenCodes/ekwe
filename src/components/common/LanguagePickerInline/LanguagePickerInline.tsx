import { Search, Star, X, Check } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  SectionList,
} from 'react-native';
import { LANGUAGES, Language } from 'src/constants/languages';
import { useTheme } from 'src/hooks/useTheme';

import { LanguagePickerInlineProps } from './LanguagePickerInline.types';

const FLAG_MAP: Record<string, string> = {
  en: '🇬🇧',
  es: '🇪🇸',
  it: '🇮🇹',
  de: '🇩🇪',
  zh: '🇨🇳',
  fr: '🇫🇷',
  pt: '🇵🇹',
  ru: '🇷🇺',
  ja: '🇯🇵',
  ko: '🇰🇷',
  ar: '🇸🇦',
  hi: '🇮🇳',
  nl: '🇳🇱',
  pl: '🇵🇱',
  tr: '🇹🇷',
  sv: '🇸🇪',
  da: '🇩🇰',
  fi: '🇫🇮',
  nb: '🇳🇴',
  cs: '🇨🇿',
  sk: '🇸🇰',
  ro: '🇷🇴',
  hu: '🇭🇺',
  uk: '🇺🇦',
  el: '🇬🇷',
  he: '🇮🇱',
  th: '🇹🇭',
  vi: '🇻🇳',
  id: '🇮🇩',
  ms: '🇲🇾',
  bg: '🇧🇬',
  hr: '🇭🇷',
  sr: '🇷🇸',
  ca: '🇪🇸',
  lt: '🇱🇹',
  lv: '🇱🇻',
  et: '🇪🇪',
  sl: '🇸🇮',
  sq: '🇦🇱',
  mk: '🇲🇰',
  af: '🇿🇦',
  bn: '🇧🇩',
  fa: '🇮🇷',
  ur: '🇵🇰',
  sw: '🇰🇪',
  tl: '🇵🇭',
  ta: '🇮🇳',
  te: '🇮🇳',
  ml: '🇮🇳',
  mr: '🇮🇳',
  gu: '🇮🇳',
  pa: '🇮🇳',
  ne: '🇳🇵',
  si: '🇱🇰',
  km: '🇰🇭',
  lo: '🇱🇦',
  my: '🇲🇲',
  ka: '🇬🇪',
};

interface LanguageRowProps {
  item: Language;
  isSelected: boolean;
  isPinned: boolean;
  onToggleSelect: () => void;
  onTogglePin: () => void;
}

const LanguageRow = ({
  item,
  isSelected,
  isPinned,
  onToggleSelect,
  onTogglePin,
}: LanguageRowProps): React.ReactElement => {
  const { tokens } = useTheme();

  return (
    <Pressable
      onPress={onToggleSelect}
      testID={`lang-row-${item.code}`}
      style={[styles.row, { backgroundColor: tokens.color.background.primary }]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.flag}>{FLAG_MAP[item.code] || '🌐'}</Text>
        <View>
          <Text
            style={[
              styles.englishName,
              {
                color: tokens.color.text.primary,
                fontFamily: tokens.font.family.body,
              },
            ]}
          >
            {item.englishName}
          </Text>
          <Text
            style={[
              styles.nativeName,
              {
                color: tokens.color.text.tertiary,
                fontFamily: tokens.font.family.body,
              },
            ]}
          >
            {item.nativeName}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Pressable
          onPress={onTogglePin}
          testID={`pin-button-${item.code}`}
          hitSlop={8}
          style={styles.starButton}
        >
          <Star
            size={20}
            color={
              isPinned ? tokens.color.brand.core : tokens.color.text.tertiary
            }
            fill={isPinned ? tokens.color.brand.core : 'transparent'}
          />
        </Pressable>

        <View
          style={[
            styles.selectionCircle,
            {
              borderColor: matches(isSelected)
                ? tokens.color.brand.core
                : tokens.color.border.strong,
              backgroundColor: isSelected
                ? tokens.color.brand.core
                : 'transparent',
              borderWidth: isSelected ? 0 : 1.5,
            },
          ]}
        >
          {isSelected && (
            <Check
              size={12}
              color={tokens.color.text.inverse}
              strokeWidth={3}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
};

const matches = (val: boolean): boolean => val;

export const LanguagePickerInline = ({
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
}: LanguagePickerInlineProps): React.ReactElement => {
  const { tokens } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

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
    const next = selectedLanguages.includes(code)
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
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: tokens.color.background.secondary,
              borderColor: tokens.color.border.default,
              borderRadius: tokens.radius.md,
            },
          ]}
        >
          <Search
            size={18}
            color={tokens.color.text.tertiary}
            style={styles.searchIcon}
          />
          <TextInput
            style={[
              styles.input,
              {
                color: tokens.color.text.primary,
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
              },
            ]}
            placeholder="Search languages"
            placeholderTextColor={tokens.color.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={16} color={tokens.color.text.tertiary} />
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
          <View
            style={[
              styles.sectionHeader,
              { backgroundColor: tokens.color.background.secondary },
            ]}
          >
            <Text
              style={[
                styles.sectionHeaderText,
                {
                  color: tokens.color.text.tertiary,
                  fontSize: tokens.font.size.caption,
                },
              ]}
            >
              {title}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchBar: {
    height: 44,
    borderWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 44,
  },
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    fontSize: 20,
    marginRight: 12,
  },
  englishName: {
    fontSize: 16,
  },
  nativeName: {
    fontSize: 12,
    marginTop: 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starButton: {
    padding: 8,
  },
  selectionCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionHeaderText: {
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: 100,
  },
});
