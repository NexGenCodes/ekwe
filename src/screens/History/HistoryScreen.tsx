import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon } from 'src/assets/icons/CloseIcon';
import { DrumIcon } from 'src/assets/icons/DrumIcon';
import { SearchIcon } from 'src/assets/icons/SearchIcon';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { MOCK_HISTORY } from 'src/constants/mockData';
import { getColor } from 'src/constants/theme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useHistoryStore } from 'src/store';

export const HistoryScreen = ({
  navigation,
}: MainTabScreenProps<'History'>): React.ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const entries = useHistoryStore((s) => s.entries);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const { colorScheme } = useColorScheme();

  const displayEntries = useMemo(() => {
    const all = entries.length > 0 ? entries : MOCK_HISTORY;
    if (!searchQuery) return all;
    return all.filter(
      (e) =>
        e.transcript.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.translation?.toLowerCase().includes(searchQuery.toLowerCase()) ??
          false),
    );
  }, [entries, searchQuery]);

  const isDark = colorScheme === 'dark';
  const tertiaryColor = getColor('muted', isDark);
  const iconColor = getColor('primaryAccent', isDark);

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-6 pt-4 pb-2">
        <Text className="font-display text-[32px] leading-[38px] text-zinc-950 dark:text-zinc-50">
          History
        </Text>

        <View className="h-12 flex-row items-center px-4 bg-card dark:bg-card-dark rounded-2xl mt-6 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm">
          <SearchIcon size={18} color={iconColor} style={{ marginRight: 10 }} />
          <TextInput
            className="flex-1 h-12 text-base font-body text-zinc-950 dark:text-zinc-50"
            placeholder="Search translations..."
            placeholderTextColor={tertiaryColor}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setSearchQuery('');
              }}
              hitSlop={12}
            >
              <CloseIcon size={18} color={tertiaryColor} />
            </Pressable>
          )}
        </View>
      </View>

      <View className="flex-1">
        {displayEntries.length > 0 ? (
          <FlashList
            data={displayEntries}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 24, paddingTop: 20 }}
            renderItem={({ item }): React.ReactElement => (
              <HistoryItem
                entry={item}
                onPress={() =>
                  navigation.navigate('Result', { entryId: item.id })
                }
                onDelete={() => deleteEntry(item.id)}
              />
            )}
          />
        ) : (
          <View className="flex-1 items-center justify-center mt-[-80px]">
            <DrumIcon size={48} color={tertiaryColor} />
            <Text className="text-base font-body text-zinc-400 dark:text-zinc-500 mt-3 text-center">
              {searchQuery ? 'No matches found' : 'History is empty'}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};
