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
import { View, Text, Pressable } from 'react-native';

import { Button } from '@/components/ui';
import { LANGUAGES, Language, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';
import { auth$ } from '@/store';

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

  const mutedColor = color.muted;
  const primaryColor = color.primary;
  const onPrimaryColor = color.onPrimary;

  return (
    <Pressable
      onPress={onToggleSelect}
      className="h-[52px] flex-row items-center px-4 bg-background dark:bg-background active:opacity-60"
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
              ? 'bg-primary dark:bg-primary border-0'
              : 'bg-transparent border-[1.5px] border-zinc-300 dark:border-zinc-700'
          }`}
        >
          {isSelected && (
            <Check size={12} color={onPrimaryColor} strokeWidth={3} />
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
          <View className="px-4 py-3 border-t-[0.5px] border-zinc-200 dark:border-zinc-800 bg-background dark:bg-background">
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
        backgroundColor: bgColor,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: handleColor,
        width: 40,
      }}
    >
      <View className="z-10 bg-background dark:bg-background">
        {/* Search */}
        <View className="px-4 pb-2">
          <View className="h-11 border-[0.5px] border-zinc-200 dark:border-zinc-800 rounded-xl flex-row items-center px-3 bg-card dark:bg-card">
            <Search size={18} color={mutedColor} style={{ marginRight: 8 }} />
            <BottomSheetTextInput
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

        {/* Fixed Pinned Section */}
        {pinnedItems.length > 0 && (
          <View>
            <View className="px-4 py-3 bg-card dark:bg-card">
              <Text className="font-semibold tracking-[0.5px] text-zinc-500 dark:text-zinc-400 text-xs">
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
        <View className="px-4 py-3 bg-card dark:bg-card">
          <Text className="font-semibold tracking-[0.5px] text-zinc-500 dark:text-zinc-400 text-xs">
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
