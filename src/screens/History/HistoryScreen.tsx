import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useColorScheme } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrumIcon } from 'src/assets/icons/DrumIcon';
import { SearchIcon } from 'src/assets/icons/SearchIcon';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { getColor } from 'src/constants/colors';
import { useHistory } from 'src/hooks/useHistory';
import { RootStackParamList } from 'src/navigation/RootNavigator';
import { HistoryEntry } from 'src/store/historySlice';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const HistoryScreen = (): React.JSX.Element => {
  const navigation = useNavigation<Nav>();
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
    navigation.navigate('Result', {
      sessionId: entry.id,
      transcript: entry.transcript,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      duration: entry.duration,
      isHistoryReplay: true,
    });
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <View className="px-4 py-4">
        <Text className="font-bodyMed text-2xl text-foreground">History</Text>

        {/* Search */}
        <View className="flex-row items-center px-4 h-12 rounded-2xl mt-4 border bg-card border-border">
          <SearchIcon size={18} color={mutedColor} />
          <TextInput
            className="flex-1 ml-2 font-body text-base text-foreground"
            placeholder="Search transcripts..."
            placeholderTextColor={mutedColor}
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </View>

      <View className="flex-1">
        {sections.length === 0 ? (
          <View className="flex-1 items-center justify-center pb-20">
            <DrumIcon size={48} color={mutedColor} />
            <Text className="font-body text-base mt-4 text-muted">
              No records found
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section: { title } }) => (
              <Text className="font-bodyMed text-xs uppercase tracking-widest px-4 pt-6 pb-2 text-muted">
                {title}
              </Text>
            )}
            renderItem={({ item }) => (
              <View className="px-2">
                <HistoryItem
                  entry={item}
                  onPress={() => handleEntryPress(item)}
                  onDelete={() => deleteEntry(item.id)}
                />
              </View>
            )}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
};
