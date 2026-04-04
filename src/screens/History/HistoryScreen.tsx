import { FlashList } from '@shopify/flash-list';
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon } from 'src/assets/icons/CloseIcon';
import { DrumIcon } from 'src/assets/icons/DrumIcon';
import { SearchIcon } from 'src/assets/icons/SearchIcon';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { MOCK_HISTORY } from 'src/constants/mockData';
import { useTheme } from 'src/hooks/useTheme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useHistoryStore } from 'src/store';

export const HistoryScreen = ({
  navigation,
}: MainTabScreenProps<'History'>): React.ReactElement => {
  const { tokens } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const entries = useHistoryStore((s) => s.entries);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);

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

  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            {
              fontFamily: tokens.font.family.bodyMed,
              fontSize: tokens.font.size.heading,
              color: tokens.color.text.primary,
            },
          ]}
        >
          History
        </Text>

        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: tokens.color.background.secondary,
              borderRadius: tokens.radius.md,
              marginTop: tokens.space[4],
            },
          ]}
        >
          <SearchIcon
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
            placeholder="Search history"
            placeholderTextColor={tokens.color.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <CloseIcon size={16} color={tokens.color.text.tertiary} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.listContainer}>
        {displayEntries.length > 0 ? (
          <FlashList
            data={displayEntries}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
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
          <View style={styles.emptyState}>
            <DrumIcon size={48} color={tokens.color.text.tertiary} />
            <Text
              style={[
                styles.emptyTitle,
                {
                  fontFamily: tokens.font.family.body,
                  color: tokens.color.text.tertiary,
                  marginTop: tokens.space[3],
                },
              ]}
            >
              {searchQuery ? 'No matches found' : 'History is empty'}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
  },
  title: {
    letterSpacing: -0.5,
  },
  searchBar: {
    height: 44,
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
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -80,
  },
  emptyTitle: {
    fontSize: 16,
    textAlign: 'center',
  },
});
