import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioWaveform } from '@/components/common/AudioWaveform';
import { EkweButton } from '@/components/common/EkweButton';
import { getColor } from '@/constants/colors';
import { ErrorMessages } from '@/constants/errors';
import { LANGUAGES } from '@/constants/languages';
import { AudioProcessor, ProcessedAudio } from '@/services/AudioProcessor';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';
import { useHistoryStore, useSettingsStore } from '@/store';

export default function ResultScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const router = useRouter();

  const getLanguageName = (code: string): string =>
    LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

  const {
    uri,
    entryId,
    transcript: initialTranscript = '',
    sourceLang: initialSourceLang,
    targetLang: initialTargetLang,
    isHistoryReplay: initialIsHistoryReplay = false,
  } = params;

  // Store & Settings
  const entries = useHistoryStore((s) => s.entries);
  const addEntry = useHistoryStore((s) => s.addEntry);
  const defaultSourceLang = useSettingsStore((s) => s.selectedLanguages[0]);
  const defaultTargetLang = useSettingsStore((s) => s.targetLanguage);

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  // Local State
  const foundEntry = entryId ? entries.find((e) => e.id === entryId) : null;
  const [transcript, setTranscript] = useState(
    foundEntry?.transcript || (initialTranscript as string),
  );
  const [translation, setTranslation] = useState(
    foundEntry?.translation || null,
  );
  const [sourceLang] = useState(
    foundEntry?.sourceLang ||
      (initialSourceLang as string) ||
      defaultSourceLang ||
      'en',
  );
  const [targetLang] = useState(
    foundEntry?.targetLang ||
      (initialTargetLang as string) ||
      defaultTargetLang ||
      'es',
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);

  const isHistoryReplay = !!foundEntry || initialIsHistoryReplay === 'true';

  // Transcription Pipeline (Auto-trigger if uri is provided)
  const processSharedAudio = useCallback(
    async (audioUri: string): Promise<void> => {
      setIsProcessing(true);
      try {
        const validate = await AudioProcessor.validateSharedFile(audioUri);
        if (!validate.ok) {
          Alert.alert('Error', 'Failed to validate audio file.');
          return;
        }

        const processed: ProcessedAudio = {
          uri: audioUri,
          durationMs: 0,
          trimStartMs: 0,
          trimEndMs: 0,
          hasSpeech: true,
          averageDb: 1,
          meteringData: [],
        };

        const result = await TranscriptionService.transcribe(
          processed,
          sourceLang,
        );
        if (result.ok) {
          setTranscript(result.value.transcript);
          // Save to history
          addEntry({
            id: `res_${Date.now()}`,
            sourceLang,
            targetLang,
            transcript: result.value.transcript,
            translation: null,
            timestamp: Date.now(),
            duration: result.value.durationSeconds * 1000,
            sourceApp: 'shared',
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert(
            'Transcription Failed',
            ErrorMessages[result.error] ?? 'Could not process the voice note.',
          );
        }
      } catch {
        Alert.alert('Error', 'An unexpected error occurred.');
      } finally {
        setIsProcessing(false);
      }
    },
    [addEntry, sourceLang, targetLang],
  );

  useEffect(() => {
    if (uri && !transcript && !isProcessing) {
      processSharedAudio(uri as string);
    }
  }, [uri, transcript, isProcessing, processSharedAudio]);

  const handleTranslate = async (): Promise<void> => {
    if (!transcript) return;
    setIsTranslating(true);
    try {
      const result = await TranslationService.translate(
        transcript,
        sourceLang,
        targetLang,
      );
      if (result.ok) {
        setTranslation(result.value.translation);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Translation Failed', 'Try again in a moment.');
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async (text: string): Promise<void> => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      {/* Header */}
      <View className="px-6 py-4 flex-row justify-between items-center bg-background dark:bg-background-dark border-b border-border dark:border-border-dark">
        <Text className="font-display text-xl text-foreground dark:text-foreground-dark">
          {isHistoryReplay ? 'History Record' : 'Translation Result'}
        </Text>
        <EkweButton
          variant="ghost"
          size="small"
          label="Close"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
        />
      </View>

      <ScrollView
        className="flex-1 px-6 bg-background dark:bg-background-dark"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Status Indicator */}
        {isProcessing && (
          <View className="items-center py-12 space-y-4">
            <ActivityIndicator size="large" color={primaryColor} />
            <View className="items-center">
              <Text className="font-display text-lg text-foreground dark:text-foreground-dark">
                Processing Audio
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark mt-1">
                This usually takes a few seconds...
              </Text>
            </View>
          </View>
        )}

        {/* Content Blocks */}
        {!isProcessing && transcript.length > 0 && (
          <View className="mt-8">
            {/* Original Text */}
            <View className="mb-8">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted dark:text-muted-dark">
                  ORIGINAL · {getLanguageName(sourceLang)}
                </Text>
                <View className="flex-row gap-2">
                  <EkweButton
                    variant="ghost"
                    size="small"
                    label={copied ? 'Copied' : 'Copy'}
                    onPress={() => handleCopy(transcript)}
                  />
                </View>
              </View>
              <View className="bg-card dark:bg-card-dark p-6 rounded-[20px] border border-border dark:border-border-dark">
                <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                  {transcript}
                </Text>
              </View>
            </View>

            {/* Translation Text (Result) */}
            {translation ? (
              <View className="mb-8">
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="font-bodyMed text-xs uppercase tracking-widest text-primary dark:text-primary-dark">
                    TRANSLATED · {getLanguageName(targetLang)}
                  </Text>
                </View>
                <View className="bg-primary/5 dark:bg-primary-dark/10 p-6 rounded-[20px] border border-primary/20 dark:border-primary-dark/30">
                  <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                    {translation}
                  </Text>
                </View>
              </View>
            ) : (
              <View className="items-center py-6">
                {isTranslating ? (
                  <ActivityIndicator color={primaryColor} />
                ) : (
                  <EkweButton
                    variant="primary"
                    size="medium"
                    label={`Translate to ${getLanguageName(targetLang)}`}
                    onPress={handleTranslate}
                  />
                )}
              </View>
            )}
          </View>
        )}

        {/* Replay context if history */}
        {isHistoryReplay && !isProcessing && (
          <View className="mt-4 bg-card dark:bg-card-dark p-6 rounded-[20px] border border-border dark:border-border-dark">
            <Text className="font-bodyMed text-xs text-muted dark:text-muted-dark mb-4 uppercase tracking-widest">
              Voice Architecture
            </Text>
            <AudioWaveform amplitudes={[]} progress={0.4} height={60} />
          </View>
        )}
      </ScrollView>

      {/* Global Action Bar */}
      {!isProcessing && translation && (
        <View className="px-6 py-8 border-t border-border dark:border-border-dark bg-background dark:bg-background-dark">
          <EkweButton
            variant="secondary"
            size="large"
            label={copied ? 'Copied' : 'Copy Full Translation'}
            onPress={() => handleCopy(`${transcript}\n\n---\n\n${translation}`)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
