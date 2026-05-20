import BottomSheet, {
  BottomSheetSectionList,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetFooter,
  BottomSheetFooterProps,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSelector } from '@legendapp/state/react';
import { Search, Star, X, Check } from 'lucide-react-native';
import React, {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/ui';
import { LANGUAGES, Language, FLAG_MAP } from '@/constants/languages';
import { useTheme, usePermissions } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils';

interface LanguageRowProps {
  item: Language;
  isSelected: boolean;
  isPinned: boolean;
  onToggleSelect: () => void;
  onTogglePin: () => void;
}

export interface LanguagePickerSheetProps {
  isVisible: boolean;
  selectedLanguages: string[];
  pinnedLanguages: string[];
  onSelectionChange: (
    selectedLanguages: string[],
    pinnedLanguages: string[],
  ) => void;
  onClose: () => void;
  singleSelect?: boolean;
}

// Row component for the section list
const LanguageRow = ({
  item,
  isSelected,
  isPinned,
  onToggleSelect,
  onTogglePin,
}: LanguageRowProps): React.ReactElement => {
  const { color } = useTheme();

  return (
    <Pressable
      onPress={onToggleSelect}
      style={[styles.rowContainer, { backgroundColor: color.background }]}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.flagText}>{FLAG_MAP[item.code] || '🌐'}</Text>
        <View>
          <Text style={[styles.englishName, { color: color.foreground }]}>
            {item.englishName}
          </Text>
          <Text style={[styles.nativeName, { color: color.muted }]}>
            {item.nativeName}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Pressable onPress={onTogglePin} hitSlop={8} style={styles.pinButton}>
          <Star
            size={20}
            color={isPinned ? color.secondary : color.muted}
            fill={isPinned ? color.secondary : 'transparent'}
          />
        </Pressable>

        <View
          style={[
            styles.checkCircle,
            isSelected
              ? { backgroundColor: color.secondary, borderWidth: 0 }
              : { backgroundColor: 'transparent', borderColor: color.border },
          ]}
        >
          {isSelected && (
            <Check size={12} color={color.onSecondary} strokeWidth={3} />
          )}
        </View>
      </View>
    </Pressable>
  );
};

export const LanguagePickerSheet = ({
  isVisible,
  selectedLanguages,
  pinnedLanguages,
  onSelectionChange,
  onClose,
  singleSelect = false,
}: LanguagePickerSheetProps): React.ReactElement => {
  const { color } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());
  const permissions = usePermissions();
  const maxLanguages = permissions.maxPinnedLanguages;
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const [searchQuery, setSearchQuery] = useState('');

  const bgColor = color.background;
  const handleColor = color.border;
  const mutedColor = color.muted;

  useEffect(() => {
    if (isVisible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [isVisible]);

  const availableLanguages = useMemo(() => {
    if (isPro) return LANGUAGES;
    return LANGUAGES.filter((l) => !l.proOnly);
  }, [isPro]);

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q === '') return availableLanguages;
    return availableLanguages.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q),
    );
  }, [searchQuery, availableLanguages]);

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
    (props: BottomSheetFooterProps) => {
      if (singleSelect) return null;
      return (
        <BottomSheetFooter {...props} bottomInset={16}>
          <View
            style={[
              styles.footerContainer,
              {
                backgroundColor: color.background,
                borderTopColor: color.border,
              },
            ]}
          >
            <Button label="Confirm" onPress={onClose} variant="primary" />
          </View>
        </BottomSheetFooter>
      );
    },
    [onClose, singleSelect],
  );

  const toggleSelection = (code: string): void => {
    if (singleSelect) {
      onSelectionChange([code], pinnedLanguages);
      return;
    }

    const isCurrentlySelected = selectedLanguages.includes(code);
    if (!isCurrentlySelected && selectedLanguages.length >= maxLanguages) {
      AppAlert.info(
        'Language Limit Reached',
        `You can only select up to ${maxLanguages} languages on your current plan. Upgrade to Pro for more.`,
      );
      return;
    }

    const next = isCurrentlySelected
      ? selectedLanguages.filter((c) => c !== code)
      : [...selectedLanguages, code];
    onSelectionChange(next, pinnedLanguages);
  };

  const togglePin = (code: string): void => {
    const isCurrentlyPinned = pinnedLanguages.includes(code);
    if (!isCurrentlyPinned && pinnedLanguages.length >= maxLanguages) {
      AppAlert.info(
        'Language Limit Reached',
        `You can only pin up to ${maxLanguages} languages on your current plan. Upgrade to Pro for more.`,
      );
      return;
    }

    const next = isCurrentlyPinned
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
        backgroundColor: bgColor,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: handleColor,
        width: 40,
      }}
    >
      <View style={{ zIndex: 10, backgroundColor: bgColor }}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <View
            style={[
              styles.searchInputWrapper,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Search size={18} color={mutedColor} style={{ marginRight: 8 }} />
            <BottomSheetTextInput
              style={[styles.searchInput, { color: color.foreground }]}
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

        {/* Fixed Pinned Section */}
        {pinnedItems.length > 0 && (
          <View>
            <View
              style={[styles.sectionHeader, { backgroundColor: color.surface }]}
            >
              <Text style={[styles.sectionHeaderText, { color: color.muted }]}>
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
          style={[styles.sectionHeader, { backgroundColor: color.surface }]}
        >
          <Text style={[styles.sectionHeaderText, { color: color.muted }]}>
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
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  rowContainer: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  flagText: { fontSize: 20, marginRight: 12 },
  englishName: { fontSize: 16, fontFamily: 'Outfit-Regular' },
  nativeName: { fontSize: 12, marginTop: 2, fontFamily: 'Outfit-Regular' },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  pinButton: { padding: 8 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  footerContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
  },
  searchContainer: { paddingHorizontal: 16, paddingBottom: 8 },
  searchInputWrapper: {
    height: 44,
    borderWidth: 0.5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 16,
    fontFamily: 'Outfit-Regular',
  },
  sectionHeader: { paddingHorizontal: 16, paddingVertical: 12 },
  sectionHeaderText: {
    fontFamily: 'Outfit-Medium',
    letterSpacing: 0.5,
    color: '#71717A',
    fontSize: 12,
  },
});
