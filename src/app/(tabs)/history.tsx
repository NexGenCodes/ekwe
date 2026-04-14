import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import Animated, {
  FadeInUp,
  FadeInDown,
  Layout,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloseIcon } from '@/assets/icons/CloseIcon';
import { DrumIcon } from '@/assets/icons/DrumIcon';
import { SearchIcon } from '@/assets/icons/SearchIcon';
import { HistoryItem } from '@/components/cards/HistoryItem';
import { getColor } from '@/constants/colors';
import { useHistory } from '@/hooks/useHistory';
import { useTheme } from '@/hooks/useTheme';
import { HistoryEntry } from '@/store/historySlice';

export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const { entries, deleteEntry } = useHistory();
  const [query, setQuery] = useState('');
  const { colorScheme } = useTheme();
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
              <View className="w-16 h-16 bg-primary/10 rounded-full items-center justify-center mb-6">
                <DrumIcon size={32} color={getColor('primary', isDark)} />
              </View>
              <Text className="font-display text-xl text-foreground dark:text-foreground-dark text-center mb-2">
                {query.length > 0 ? 'No Matches Found' : 'Silent Library'}
              </Text>
              <Text className="font-body text-sm text-muted dark:text-zinc-500 text-center leading-5">
                {query.length > 0
                  ? "We couldn't find any transcripts matching your search."
                  : 'Your voice note history will appear here.'}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <ScrollView
            className="flex-1 px-4 bg-background dark:bg-background-dark"
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {sections.map((section, sIndex) => (
              <Animated.View
                key={section.title}
                entering={FadeInUp.duration(500)
                  .delay(sIndex * 150)
                  .springify()}
                layout={Layout.springify()}
              >
                <Text className="font-bodyMed text-[11px] uppercase tracking-[0.15em] px-2 pt-6 pb-3 text-muted dark:text-zinc-500">
                  {section.title}
                </Text>
                <View className="gap-3">
                  {section.data.map((item, index) => (
                    <Animated.View
                      key={item.id}
                      entering={FadeInUp.duration(400)
                        .delay(index * 50)
                        .springify()}
                      layout={Layout.springify()}
                    >
                      <HistoryItem
                        entry={item}
                        onPress={() => handleEntryPress(item)}
                        onDelete={() => deleteEntry(item.id)}
                        // Inject standalone card styling directly to override default borders
                        style={{
                          borderRadius: 20,
                          borderWidth: 1,
                          borderColor: isDark
                            ? 'rgba(255,255,255,0.05)'
                            : 'rgba(0,0,0,0.05)',
                          borderBottomWidth: 1,
                          overflow: 'hidden',
                        }}
                      />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
