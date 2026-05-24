import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';

import { CloseIcon } from '@/assets/icons/CloseIcon';
import { DrumIcon } from '@/assets/icons/DrumIcon';
import { SearchIcon } from '@/assets/icons/SearchIcon';
import { HistoryItem } from '@/components';
import { EmptyState, IconContainer } from '@/components/ui';
import { borderRadius, spacing, typography } from '@/constants/designTokens';
import { Db } from '@/services/db';
import { useHistory, useTheme } from '@/hooks';
import { HistoryEntry } from '@/store';

const DEBOUNCE_DELAY_MS = 150;

function rowToEntry(row: { id: string; source_lang: string; target_lang: string; transcript: string; translation_text: string | null; transliteration_text: string | null; duration: number; source_app: string; provider: string; created_at: string; deleted: number }): HistoryEntry {
  return {
    id: row.id,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    transcript: row.transcript,
    translation: row.translation_text,
    transliteration: row.transliteration_text,
    duration: row.duration,
    sourceApp: row.source_app,
    provider: row.provider,
    timestamp: new Date(row.created_at).getTime(),
    deleted: row.deleted === 1,
  };
}

function computeSections(entries: HistoryEntry[]): { title: string; data: HistoryEntry[] }[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const today: HistoryEntry[] = [];
  const yesterday: HistoryEntry[] = [];
  const earlier: HistoryEntry[] = [];

  entries.forEach((e) => {
    const diff = now - e.timestamp;
    if (diff < day) today.push(e);
    else if (diff < 2 * day) yesterday.push(e);
    else earlier.push(e);
  });

  return [
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Earlier', data: earlier },
  ].filter((s) => s.data.length > 0);
}

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const { entries, deleteEntry, loadMore, hasMore } = useHistory();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY_MS);
    return (): void => clearTimeout(t);
  }, [query]);
  const { color } = useTheme();

  const sections = useMemo(() => {
    if (debouncedQuery.trim().length > 0) {
      const rows = Db.searchHistory(debouncedQuery, 200);
      return computeSections(rows.map(rowToEntry));
    }
    return computeSections(entries);
  }, [entries, debouncedQuery]);

  const handleEntryPress = useCallback(
    (entry: HistoryEntry): void => {
      router.push({
        pathname: '/result',
        params: {
          sessionId: entry.id,
          transcript: entry.transcript,
          sourceLang: entry.sourceLang,
          targetLang: entry.targetLang,
          duration: entry.duration,
          isHistoryReplay: 'true',
        },
      });
    },
    [router],
  );

  type ListItem =
    | { type: 'header'; title: string }
    | { type: 'entry'; data: HistoryEntry };

  const flatData = useMemo(() => {
    const data: ListItem[] = [];
    sections.forEach((section) => {
      data.push({ type: 'header', title: section.title });
      section.data.forEach((entry) => {
        data.push({ type: 'entry', data: entry });
      });
    });
    return data;
  }, [sections]);

  const itemStyle = useMemo<ViewStyle>(
    () => ({
      borderRadius: borderRadius['2xl'],
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    }),
    [color.border],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }): React.ReactElement => {
      if (item.type === 'header') {
        return (
          <Text style={[styles.headerText, { color: color.muted }]}>
            {item.title}
          </Text>
        );
      }

      return (
        <View style={styles.entryContainer}>
          <HistoryItem
            entry={item.data}
            onPress={handleEntryPress}
            onDelete={deleteEntry}
            style={itemStyle}
          />
        </View>
      );
    },
    [handleEntryPress, deleteEntry, itemStyle, color.muted],
  );

  return (
    <View style={[styles.flex1, { backgroundColor: color.background }]}>
      <View style={styles.topSection}>
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          style={[
            styles.searchContainer,
            {
              backgroundColor: color.card,
              borderColor: isFocused ? color.secondary : color.border,
            },
          ]}
        >
          <SearchIcon size={20} color={color.secondary} />
          <TextInput
            style={[styles.searchInput, { color: color.foreground }]}
            placeholder="Search transcripts..."
            placeholderTextColor={color.muted}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setQuery('');
              }}
              hitSlop={12}
              style={({ pressed }) => [
                styles.clearButton,
                pressed && styles.clearButtonPressed,
              ]}
            >
              <CloseIcon size={18} color={color.muted} />
            </Pressable>
          )}
        </Animated.View>
      </View>

      {sections.length === 0 ? (
        <Animated.View
          entering={FadeInUp.duration(600).springify()}
          style={styles.emptyStateContainer}
        >
          <View
            style={[
              styles.emptyStateCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <EmptyState
              icon={
                <IconContainer size="lg" backgroundColor={`${color.primary}15`}>
                  {process.env.EXPO_OS === 'ios' ? (
                    <ExpoImage
                      source="sf:clock.fill"
                      style={{ width: 32, height: 32 }}
                      tintColor={color.primary}
                    />
                  ) : (
                    <DrumIcon size={32} color={color.primary} />
                  )}
                </IconContainer>
              }
              title={query.length > 0 ? 'No Matches Found' : 'Silent Library'}
              subtitle={
                query.length > 0
                  ? "We couldn't find any transcripts matching your search."
                  : 'Your voice note history will appear here.'
              }
            />
          </View>
        </Animated.View>
      ) : (
        <View style={styles.listContainer}>
          <FlashList
            data={flatData}
            renderItem={renderItem}
            getItemType={(item) => item.type}
            keyExtractor={(item, index) =>
              item.type === 'header'
                ? `header-${item.title}`
                : `entry-${item.data.id || index}`
            }
            ListFooterComponent={<View style={{ height: 40 }} />}
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="automatic"
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  headerText: {
    fontFamily: 'Outfit-Bold',
    fontSize: typography.caption.size + 1,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[8],
    paddingBottom: spacing[4],
  },
  entryContainer: { marginBottom: spacing[3] },
  topSection: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    height: 56,
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[4],
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing[3],
    fontFamily: 'Outfit-Regular',
    fontSize: typography.body.size,
  },
  clearButton: { padding: spacing[2] },
  clearButtonPressed: { transform: [{ scale: 0.95 }] },
  emptyStateContainer: {
    flex: 1,
    paddingHorizontal: spacing[8],
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyStateCard: {
    width: '100%',
    padding: 40,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  listContainer: { flex: 1, paddingHorizontal: spacing[4] },
});
