import * as Clipboard from 'expo-clipboard';
import { useColorScheme } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon } from 'src/assets/icons/CloseIcon';
import { TranslationCard } from 'src/components/cards/TranslationCard';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { MOCK_HISTORY } from 'src/constants/mockData';
import { getColor } from 'src/constants/theme';
import { ResultScreenProps } from 'src/navigation/types';
import { useHistoryStore } from 'src/store';

export const ResultScreen = ({
  route,
  navigation,
}: ResultScreenProps): React.ReactElement => {
  const { entryId } = route.params;
  const entries = useHistoryStore((s) => s.entries);
  const [, setCopied] = useState(false);
  const { colorScheme } = useColorScheme();

  const entry = useMemo(() => {
    const found = entries.find((e) => e.id === entryId);
    return (
      found || MOCK_HISTORY.find((e) => e.id === entryId) || MOCK_HISTORY[0]
    );
  }, [entries, entryId]);

  const handleCopy = async (): Promise<void> => {
    await Clipboard.setStringAsync(entry.translation ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Mock waveform data
  const mockWaveform = Array.from({ length: 40 }, () => Math.random());
  const isDark = colorScheme === 'dark';
  const iconColor = getColor('foreground', isDark);

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="h-14 justify-center px-2">
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          className="p-2 w-10 h-10 items-center justify-center active:opacity-60"
        >
          <CloseIcon size={24} color={iconColor} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-6 py-8 items-center">
          <AudioWaveform
            amplitudes={mockWaveform}
            progress={0}
            onSeek={() => {}}
            height={60}
          />
        </View>

        <View className="px-4">
          <TranslationCard
            translation={entry.translation ?? ''}
            targetLang={entry.targetLang}
            onCopy={handleCopy}
            onShare={() => {}} // Phase 6
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
