import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloseIcon } from '@/assets/icons/CloseIcon';
import { DrumIcon } from '@/assets/icons/DrumIcon';
import { SearchIcon } from '@/assets/icons/SearchIcon';
import { HistoryItem } from '@/components';
import { EmptyState, IconContainer } from '@/components/ui';
import { useHistory, useTheme } from '@/hooks';
import { HistoryEntry } from '@/store';

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const { entries, deleteEntry } = useHistory();
  const [query, setQuery] = useState('');
  const { color } = useTheme();
  const mutedColor = color.muted;

  const sections = useMemo(() => {
    const filtered = entries.filter((e) =>
      e.transcript.toLowerCase().includes(query.toLowerCase()),
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
  }, [entries, query]);

  const handleEntryPress = (entry: HistoryEntry): void => {
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
  };

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

  const renderItem = ({ item }: { item: ListItem }): React.ReactElement => {
    if (item.type === 'header') {
      return (
        <Text className="font-bodyMed text-[11px] uppercase tracking-[0.15em] px-2 pt-6 pb-3 text-muted dark:text-zinc-500">
          {item.title}
        </Text>
      );
    }

    return (
      <View className="mb-3">
        <HistoryItem
          entry={item.data}
          onPress={() => handleEntryPress(item.data)}
          onDelete={() => deleteEntry(item.data.id)}
          style={{
            borderRadius: 20,
            borderWidth: 1,
            borderColor: color.border,
            borderBottomWidth: 1,
            overflow: 'hidden',
          }}
        />
      </View>
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-6 py-4">
        <Text className="font-display text-[28px] tracking-tight text-foreground dark:text-foreground-dark">
          History
        </Text>

        {/* Search */}
        <Animated.View
          entering={FadeInDown.duration(400).springify()}
          className="flex-row items-center px-5 h-14 rounded-[20px] mt-4 border bg-card dark:bg-card-dark border-border/50 dark:border-zinc-800/80 shadow-sm"
        >
          <SearchIcon size={20} color={mutedColor} />
          <TextInput
            className="flex-1 ml-3 font-body text-[15px] text-foreground dark:text-foreground-dark"
            placeholder="Search transcripts..."
            placeholderTextColor={mutedColor}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setQuery('');
              }}
              className="p-2"
            >
              <CloseIcon size={18} color={mutedColor} />
            </Pressable>
          )}
        </Animated.View>
      </View>

      <View className="flex-1 bg-background dark:bg-background-dark">
        {sections.length === 0 ? (
          <Animated.View
            entering={FadeInUp.duration(600).springify()}
            className="flex-1 px-8 items-center justify-center pb-20"
          >
            <View className="w-full bg-card dark:bg-card-dark p-10 rounded-[32px] items-center border border-dashed border-border dark:border-zinc-800/80">
              <EmptyState
                icon={
                  <IconContainer size="lg">
                    <DrumIcon size={32} color={color.primary} />
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
          <View className="flex-1 px-4">
            <FlashList
              data={flatData}
              renderItem={renderItem}
              getItemType={(item) => item.type}
              // @ts-expect-error - FlashList 2.0.2 typing issue
              estimatedItemSize={100}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
