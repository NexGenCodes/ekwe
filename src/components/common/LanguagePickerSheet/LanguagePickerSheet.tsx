import BottomSheet, {
  BottomSheetSectionList,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetFooter,
  BottomSheetFooterProps,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Search, Star, X, Check } from 'lucide-react-native';
import React, {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { EkweButton } from 'src/components/common/EkweButton';
import { LANGUAGES, Language } from 'src/constants/languages';
import { useTheme } from 'src/hooks/useTheme';

import { LanguagePickerSheetProps } from './LanguagePickerSheet.types';

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
        <Pressable onPress={onTogglePin} hitSlop={8} style={styles.starButton}>
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

// Helper for TypeScript
const matches = (val: boolean): boolean => val;

export const LanguagePickerSheet = ({
  isVisible,
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
  onClose,
}: LanguagePickerSheetProps): React.ReactElement => {
  const { tokens } = useTheme();
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isVisible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [isVisible]);

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === '') return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const pinnedItems = useMemo(
    () => filteredLanguages.filter((l) => pinnedLanguages.includes(l.code)),
    [filteredLanguages, pinnedLanguages],
  );

  const otherItems = useMemo(
    () => filteredLanguages.filter((l) => !pinnedLanguages.includes(l.code)),
    [filteredLanguages, pinnedLanguages],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        onPress={onClose}
      />
    ),
    [onClose],
  );

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={tokens.space[4]}>
        <View
          style={[
            styles.footer,
            {
              backgroundColor: tokens.color.background.primary,
              borderTopColor: tokens.color.border.default,
            },
          ]}
        >
          <EkweButton label="Confirm" onPress={onClose} variant="primary" />
        </View>
      </BottomSheetFooter>
    ),
    [onClose, tokens],
  );

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
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
      backgroundStyle={{
        backgroundColor: tokens.color.background.primary,
        borderTopLeftRadius: tokens.radius.xl,
        borderTopRightRadius: tokens.radius.xl,
      }}
      handleIndicatorStyle={{
        backgroundColor: tokens.color.border.strong,
        width: 40,
      }}
    >
      <View style={styles.fixedHeader}>
        {/* Search */}
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
            <BottomSheetTextInput
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

        {/* Fixed Pinned Section */}
        {pinnedItems.length > 0 && (
          <View>
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
                PINNED
              </Text>
            </View>
            {pinnedItems.map((item) => (
              <LanguageRow
                key={`pinned-${item.code}`}
                item={item}
                isSelected={selectedLanguages.includes(item.code)}
                isPinned
                onToggleSelect={() => toggleSelection(item.code)}
                onTogglePin={() => togglePin(item.code)}
              />
            ))}
          </View>
        )}

        {/* Fixed "All Languages" Header */}
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
            {searchQuery ? 'RESULTS' : 'ALL LANGUAGES'}
          </Text>
        </View>
      </View>

      <BottomSheetSectionList
        sections={[{ title: '', data: otherItems }]}
        keyExtractor={(item: Language, index: number) =>
          `${item.code}-${index}`
        }
        renderItem={({ item }: { item: Language }) => (
          <LanguageRow
            item={item}
            isSelected={selectedLanguages.includes(item.code)}
            isPinned={false}
            onToggleSelect={() => toggleSelection(item.code)}
            onTogglePin={() => togglePin(item.code)}
          />
        )}
        contentContainerStyle={styles.listContent}
      />
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  fixedHeader: {
    zIndex: 1,
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
    paddingBottom: 100, // Extra padding for the sticky footer
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
  },
});
