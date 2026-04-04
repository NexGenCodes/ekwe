import * as Clipboard from 'expo-clipboard';
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon } from 'src/assets/icons/CloseIcon';
import { TranslationCard } from 'src/components/cards/TranslationCard';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { MOCK_HISTORY } from 'src/constants/mockData';
import { useTheme } from 'src/hooks/useTheme';
import { ResultScreenProps } from 'src/navigation/types';
import { useHistoryStore } from 'src/store';

export const ResultScreen = ({
  route,
  navigation,
}: ResultScreenProps): React.ReactElement => {
  const { tokens } = useTheme();
  const { entryId } = route.params;
  const entries = useHistoryStore((s) => s.entries);
  const [, setCopied] = useState(false);

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

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.closeButton}
        >
          <CloseIcon size={24} color={tokens.color.text.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.waveformContainer}>
          <AudioWaveform
            amplitudes={mockWaveform}
            progress={0}
            onSeek={() => {}}
            height={60}
          />
        </View>

        <View style={styles.cardContainer}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  closeButton: {
    padding: 8,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  waveformContainer: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
  },
  cardContainer: {
    paddingHorizontal: 16,
  },
});
