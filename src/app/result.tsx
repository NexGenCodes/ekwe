import { BlurView } from 'expo-blur';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { AudioWaveform } from '@/components';
import { Button, Card } from '@/components/ui';
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

  const { color, isDark } = useTheme();
  const primaryColor = color.primary;
  const staticProgress = useSharedValue(0);

  const handleCopy = async (text: string): Promise<void> => {
    await copy(text);
  };

  const Container = process.env.EXPO_OS === 'ios' ? BlurView : View;
  const containerProps =
    process.env.EXPO_OS === 'ios'
      ? { intensity: 80, tint: isDark ? ('dark' as const) : ('light' as const) }
      : { style: { flex: 1, backgroundColor: color.background } };

  return (
    <Container {...containerProps} style={styles.flex1}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Status Indicator */}
        {isProcessing && !transcript && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <View style={styles.processingTextContainer}>
              <Text
                style={[styles.processingTitle, { color: color.foreground }]}
              >
                Processing Audio
              </Text>
              <Text style={[styles.processingSubtitle, { color: color.muted }]}>
                This usually takes a few seconds...
              </Text>
            </View>
          </View>
        )}

        {/* Content Blocks */}
        {transcript.length > 0 && (
          <View style={styles.blocksContainer}>
            {/* Original Text */}
            <View style={styles.block}>
              <View style={styles.blockHeader}>
                <Text style={[styles.blockLabel, { color: color.muted }]}>
                  ORIGINAL · {getLanguageName(sourceLang)}{' '}
                  {isProcessing && '✨ POLISHING'}
                </Text>
                <View style={styles.headerActions}>
                  <Button
                    variant="ghost"
                    size="small"
                    label={copied ? 'Copied' : 'Copy'}
                    onPress={() => handleCopy(transcript)}
                  />
                </View>
              </View>
              <Card style={{ padding: 24, borderRadius: 20 }}>
                <Text style={[styles.cardText, { color: color.foreground }]}>
                  {transcript}
                </Text>
              </Card>
            </View>

            {/* Translation Text (Result) */}
            {translation ? (
              <View style={styles.block}>
                <View style={styles.blockHeader}>
                  <Text style={[styles.blockLabel, { color: primaryColor }]}>
                    TRANSLATED · {getLanguageName(targetLang)}
                  </Text>
                </View>
                <Card
                  variant="accent"
                  style={{ padding: 24, borderRadius: 20 }}
                >
                  <Text style={[styles.cardText, { color: color.foreground }]}>
                    {translation}
                  </Text>
                </Card>
              </View>
            ) : (
              <View style={styles.translateActionContainer}>
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
            <Text style={[styles.voiceArchLabel, { color: color.muted }]}>
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
        <View
          style={[
            styles.actionBar,
            { borderTopColor: color.border, backgroundColor: color.background },
          ]}
        >
          <Button
            variant="secondary"
            size="large"
            label={copied ? 'Copied' : 'Copy Full Translation'}
            onPress={() => handleCopy(`${transcript}\n\n---\n\n${translation}`)}
          />
        </View>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  processingContainer: { alignItems: 'center', paddingVertical: 48, gap: 16 },
  processingTextContainer: { alignItems: 'center' },
  processingTitle: { fontFamily: 'Outfit-Medium', fontSize: 18 },
  processingSubtitle: {
    fontFamily: 'Outfit-Regular',
    fontSize: 14,
    marginTop: 4,
  },
  blocksContainer: { marginTop: 32 },
  block: { marginBottom: 32 },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  blockLabel: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  cardText: { fontFamily: 'Outfit-Regular', fontSize: 18, lineHeight: 28 },
  translateActionContainer: { alignItems: 'center', paddingVertical: 24 },
  voiceArchLabel: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  actionBar: { paddingHorizontal: 24, paddingVertical: 32, borderTopWidth: 1 },
});
