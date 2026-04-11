import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloseIcon } from '@/assets/icons/CloseIcon';
import { DrumIcon } from '@/assets/icons/DrumIcon';
import { SearchIcon } from '@/assets/icons/SearchIcon';
import { HistoryItem } from '@/components/cards/HistoryItem';
import { getColor } from '@/constants/colors';
import { useHistory } from '@/hooks/useHistory';
import { HistoryEntry } from '@/store/historySlice';

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const { entries, deleteEntry } = useHistory();
  const [query, setQuery] = useState('');
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const mutedColor = getColor('muted', isDark);

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

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-4 py-4">
        <Text className="font-bodyMed text-2xl text-foreground dark:text-foreground-dark">
          History
        </Text>

        {/* Search */}
        <View className="flex-row items-center px-4 h-12 rounded-[20px] mt-4 border bg-card dark:bg-card-dark border-border dark:border-border-dark shadow-sm">
          <SearchIcon size={18} color={mutedColor} />
          <TextInput
            className="flex-1 ml-2 font-body text-base text-foreground dark:text-foreground-dark"
            placeholder="Search transcripts..."
            placeholderTextColor={mutedColor}
            value={query}
            onChangeText={(text) => {
              if (text.length > query.length) {
                Haptics.selectionAsync();
              }
              setQuery(text);
            }}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setQuery('');
              }}
              className="p-1"
            >
              <CloseIcon size={16} color={mutedColor} />
            </Pressable>
          )}
        </View>

        {query.length > 0 && (
          <Text className="mt-2 ml-1 font-body text-[11px] text-muted dark:text-muted-dark uppercase tracking-widest">
            {
              entries.filter((e) =>
                e.transcript.toLowerCase().includes(query.toLowerCase()),
              ).length
            }{' '}
            items found
          </Text>
        )}
      </View>

      <View className="flex-1 bg-background dark:bg-background-dark">
        {sections.length === 0 ? (
          <View className="flex-1 px-8 items-center justify-center pb-20">
            <View className="w-full bg-card dark:bg-card-dark p-10 rounded-[32px] items-center border border-dashed border-border dark:border-border-dark">
              <View className="w-16 h-16 bg-primary/10 dark:bg-primary-dark/20 rounded-2xl items-center justify-center mb-6">
                <DrumIcon size={32} color={getColor('primary', isDark)} />
              </View>
              <Text className="font-display text-xl text-foreground dark:text-foreground-dark text-center mb-2">
                {query.length > 0 ? 'No Matches Found' : 'Silent Library'}
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark text-center leading-5">
                {query.length > 0
                  ? "We couldn't find any transcripts matching your current search."
                  : 'Your translated voice notes will appear here once you start recording.'}
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView
            className="flex-1 bg-background dark:bg-background-dark"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {sections.map((section) => (
              <View key={section.title}>
                <Text className="font-bodyMed text-xs uppercase tracking-widest px-6 pt-8 pb-2 text-muted dark:text-muted-dark">
                  {section.title}
                </Text>
                <View className="overflow-hidden rounded-[20px] mx-4 border border-border dark:border-border-dark shadow-sm bg-card dark:bg-card-dark">
                  {section.data.map((item) => (
                    <HistoryItem
                      key={item.id}
                      entry={item}
                      onPress={() => handleEntryPress(item)}
                      onDelete={() => deleteEntry(item.id)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
