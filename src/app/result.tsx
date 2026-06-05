import { useRouter, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import {
  ResultProcessingIndicator,
  ResultTextBlock,
} from '@/components/result';
import { Box, Pressable, ScrollArea, Spinner } from '@/components/ui';
import { getLanguageName } from '@/constants/languages';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useResultPipeline, useTheme } from '@/hooks';

export default function ResultScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();

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
    sourceApp: params.sourceApp as string | undefined,
  });

  const { color } = useTheme();

  useEffect(() => {
    if (transcript && !translation && !isTranslating && !isProcessing && !isHistoryReplay) {
      handleTranslate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isHistoryReplay]);

  return (
    <Box style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => router.back()}
      />
      <Box
        style={[styles.sheetContainer, { backgroundColor: color.background }]}
      >
        <Box style={styles.header}>
          <Box style={styles.grabberContainer}>
            <Box style={[styles.grabber, { backgroundColor: color.border }]} />
          </Box>
          <Pressable
            onPress={() => router.back()}
            style={styles.closeButton}
            hitSlop={spacing.md}
          >
            <X size={24} color={color.muted} />
          </Pressable>
        </Box>

        <ScrollArea
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          contentInsetAdjustmentBehavior="automatic"
        >
          {isProcessing && !transcript && <ResultProcessingIndicator />}

          {transcript.length > 0 && (
            <Box style={styles.blocksContainer}>
              <ResultTextBlock
                title={`ORIGINAL · ${getLanguageName(sourceLang)} ${isProcessing ? '✨ POLISHING' : ''}`}
                text={transcript}
              />

              {isTranslating ? (
                <Box style={styles.translateActionContainer}>
                  <Spinner />
                </Box>
              ) : translation ? (
                <ResultTextBlock
                  title={`TRANSLATED · ${getLanguageName(targetLang)}`}
                  text={translation}
                  variant="accent"
                />
              ) : null}
            </Box>
          )}
        </ScrollArea>
      </Box>
    </Box>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheetContainer: {
    borderTopLeftRadius: borderRadius['2xl'],
    borderTopRightRadius: borderRadius['2xl'],
    paddingBottom: spacing['4xl'],
    maxHeight: '85%',
  },
  header: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabberContainer: {
    paddingVertical: spacing.md,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: borderRadius.sm,
  },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.sm,
    padding: spacing.xs,
  },
  scrollView: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.xl },
  blocksContainer: { marginTop: spacing.xs },
  translateActionContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
});
