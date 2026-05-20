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
import { SearchIcon } from '@/assets/icons/SearchIcon';
import { HistoryItem } from '@/components';
import { EmptyState, IconContainer } from '@/components/ui';
import { useHistory, useTheme } from '@/hooks';
import { HistoryEntry } from '@/store';

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const { entries, deleteEntry } = useHistory();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search input at 150ms to avoid recomputing sections on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return (): void => clearTimeout(t);
  }, [query]);
  const { color } = useTheme();

  const sections = useMemo(() => {
    const filtered = entries.filter((e) =>
      (e.transcript ?? '').toLowerCase().includes(debouncedQuery.toLowerCase()),
    );

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const today: HistoryEntry[] = [];
    const yesterday: HistoryEntry[] = [];
    const earlier: HistoryEntry[] = [];

    filtered.forEach((e) => {
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
      borderRadius: 20,
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
            { backgroundColor: color.card, borderColor: color.border },
          ]}
        >
          <SearchIcon size={20} color={color.secondary} />
          <TextInput
            style={[styles.searchInput, { color: color.foreground }]}
            placeholder="Search transcripts..."
            placeholderTextColor={color.muted}
            value={query}
            onChangeText={setQuery}
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
                    <ExpoImage
                      source={require('@/assets/icons/DrumIcon').DrumIcon}
                      style={{ width: 32, height: 32 }}
                    />
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
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingTop: 32,
    paddingBottom: 16,
  },
  entryContainer: { marginBottom: 12 },
  topSection: { paddingHorizontal: 16, paddingBottom: 16 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 56,
    borderRadius: 20,
    marginTop: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontFamily: 'Outfit-Regular',
    fontSize: 16,
  },
  clearButton: { padding: 8 },
  clearButtonPressed: { transform: [{ scale: 0.95 }] },
  emptyStateContainer: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyStateCard: {
    width: '100%',
    padding: 40,
    borderRadius: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  listContainer: { flex: 1, paddingHorizontal: 16 },
});
