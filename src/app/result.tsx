import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioWaveform } from '@/components';
import { Button, Card, ScreenHeader } from '@/components/ui';
import { getLanguageName } from '@/constants/languages';
import { useClipboard, useResultPipeline, useTheme } from '@/hooks';

export default function ResultScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const { copied, copy } = useClipboard();

  const {
    transcript,
    translation,
    sourceLang,
    targetLang,
    isProcessing,
    isTranslating,
    isHistoryReplay,
    handleTranslate,
  } = useResultPipeline({
    uri: params.uri as string | undefined,
    entryId: params.entryId as string | undefined,
    initialTranscript: params.transcript as string | undefined,
    initialSourceLang: params.sourceLang as string | undefined,
    initialTargetLang: params.targetLang as string | undefined,
    isHistoryReplay: params.isHistoryReplay === 'true',
  });

  const { color } = useTheme();
  const primaryColor = color.primary;
  const staticProgress = useSharedValue(0);

  const handleCopy = async (text: string): Promise<void> => {
    await copy(text);
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      {/* Header */}
      <ScreenHeader
        title={isHistoryReplay ? 'History Record' : 'Translation Result'}
      />

      <ScrollView
        className="flex-1 px-6 bg-background dark:bg-background-dark"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Status Indicator */}
        {isProcessing && !transcript && (
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
        {transcript.length > 0 && (
          <View className="mt-8">
            {/* Original Text */}
            <View className="mb-8">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted dark:text-muted-dark">
                  ORIGINAL · {getLanguageName(sourceLang)}{' '}
                  {isProcessing && '✨ POLISHING'}
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    variant="ghost"
                    size="small"
                    label={copied ? 'Copied' : 'Copy'}
                    onPress={() => handleCopy(transcript)}
                  />
                </View>
              </View>
              <Card style={{ padding: 24, borderRadius: 20 }}>
                <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                  {transcript}
                </Text>
              </Card>
            </View>

            {/* Translation Text (Result) */}
            {translation ? (
              <View className="mb-8">
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="font-bodyMed text-xs uppercase tracking-widest text-primary dark:text-primary-dark">
                    TRANSLATED · {getLanguageName(targetLang)}
                  </Text>
                </View>
                <Card
                  variant="accent"
                  style={{ padding: 24, borderRadius: 20 }}
                >
                  <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                    {translation}
                  </Text>
                </Card>
              </View>
            ) : (
              <View className="items-center py-6">
                {isTranslating ? (
                  <ActivityIndicator color={primaryColor} />
                ) : (
                  <Button
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
          <Card style={{ padding: 24, borderRadius: 20 }}>
            <Text className="font-bodyMed text-xs text-muted dark:text-muted-dark mb-4 uppercase tracking-widest">
              Voice Architecture
            </Text>
            <AudioWaveform
              amplitudes={[]}
              progressSV={staticProgress}
              duration={1}
              height={60}
              interactive={false}
            />
          </Card>
        )}
      </ScrollView>

      {/* Global Action Bar */}
      {!isProcessing && translation && (
        <View className="px-6 py-8 border-t border-border dark:border-border-dark bg-background dark:bg-background-dark">
          <Button
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
