import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { EkweButton } from 'src/components/common/EkweButton';
import { TranscriptionView } from 'src/components/common/TranscriptionView';
import { LANGUAGES } from 'src/constants/languages';
import { RootStackParamList } from 'src/navigation/RootNavigator';
import { useHistoryStore } from 'src/store';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

const getLanguageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

export const ResultScreen = ({
  route,
  navigation,
}: Props): React.JSX.Element => {
  const {
    entryId,
    transcript: initialTranscript = '',
    sourceLang: initialSourceLang = 'en',
    targetLang: initialTargetLang = 'es',
    isHistoryReplay: initialIsHistoryReplay = false,
  } = route.params;

  const entries = useHistoryStore((s) => s.entries);
  const foundEntry = entryId ? entries.find((e) => e.id === entryId) : null;

  const transcript = foundEntry?.transcript || initialTranscript;
  const sourceLang = foundEntry?.sourceLang || initialSourceLang;
  const targetLang = foundEntry?.targetLang || initialTargetLang;
  const isHistoryReplay = !!foundEntry || initialIsHistoryReplay;

  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await Clipboard.setStringAsync(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async (): Promise<void> => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(transcript);
    }
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      {/* Header */}
      <View className="px-4 py-4 flex-row justify-between items-center shadow-sm">
        <Text className="font-bodyMed text-lg text-foreground">
          {isHistoryReplay ? 'History Record' : 'Translation Result'}
        </Text>
        <EkweButton
          variant="ghost"
          size="small"
          label="Back"
          onPress={() => navigation.goBack()}
        />
      </View>

      <ScrollView className="flex-1 px-4">
        {/* Transcription context */}
        <View className="mt-6 mb-8">
          <Text className="font-bodyMed text-sm uppercase tracking-widest mb-3 text-muted">
            {getLanguageName(sourceLang).toUpperCase()} →{' '}
            {getLanguageName(targetLang).toUpperCase()}
          </Text>
          <TranscriptionView
            transcript={transcript}
            isLive={!isHistoryReplay}
          />
        </View>

        {/* Replay controls if history */}
        {isHistoryReplay && (
          <View className="mb-10 bg-card p-6 rounded-3xl border border-border">
            <Text className="font-bodyMed text-xs text-muted mb-4 uppercase tracking-widest">
              Voice Recording
            </Text>
            <AudioWaveform amplitudes={[]} progress={0.4} height={60} />
          </View>
        )}
      </ScrollView>

      {/* Action Bar */}
      <View className="px-4 py-8 border-t border-border bg-background">
        <View className="flex-row gap-4">
          <View className="flex-1">
            <EkweButton
              variant="secondary"
              size="medium"
              label={copied ? 'Copied' : 'Copy Text'}
              onPress={handleCopy}
            />
          </View>
          <View className="flex-1">
            <EkweButton
              variant="primary"
              size="medium"
              label="Share"
              onPress={handleShare}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};
