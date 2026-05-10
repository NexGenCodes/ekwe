import { File as ExpoFile } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';

import { ErrorMessages } from '@/constants/errors';
import { useTranscription } from '@/hooks';
import { useTranslation } from '@/hooks';
import { useHistoryStore, useSettingsStore } from '@/store';

export interface UseResultPipelineProps {
  uri?: string;
  entryId?: string;
  initialTranscript?: string;
  initialSourceLang?: string;
  initialTargetLang?: string;
  isHistoryReplay?: boolean;
}

export const useResultPipeline = ({
  uri,
  entryId,
  initialTranscript = '',
  initialSourceLang,
  initialTargetLang,
  isHistoryReplay = false,
}: UseResultPipelineProps) => {
  const entries = useHistoryStore((s) => s.entries);
  const addEntry = useHistoryStore((s) => s.addEntry);
  const defaultSourceLang = useSettingsStore((s) => s.selectedLanguages[0]);
  const defaultTargetLang = useSettingsStore((s) => s.targetLanguage);

  const foundEntry = entryId ? entries.find((e) => e.id === entryId) : null;
  const isReplay = !!foundEntry || isHistoryReplay;

  const [transcript, setTranscript] = useState(
    foundEntry?.transcript || initialTranscript,
  );
  const [translation, setTranslation] = useState<string | null>(
    foundEntry?.translation || null,
  );
  const [sourceLang] = useState(
    foundEntry?.sourceLang || initialSourceLang || defaultSourceLang || 'en',
  );
  const [targetLang] = useState(
    foundEntry?.targetLang || initialTargetLang || defaultTargetLang || 'es',
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPolished, setHasPolished] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const { mutateAsync: transcribe } = useTranscription();
  const { mutateAsync: translate } = useTranslation();

  const processSharedAudio = useCallback(
    async (audioUri: string): Promise<void> => {
      setIsProcessing(true);
      try {
        const txResult = await transcribe({
          audio: {
            uri: audioUri,
            durationMs: 0,
            trimStartMs: 0,
            trimEndMs: 0,
            hasSpeech: true,
            averageDb: -40,
            meteringData: [],
          },
          sourceLang,
        });

        setTranscript(txResult.transcript);

        // Clean up file system
        try {
          new ExpoFile(audioUri).delete();
        } catch {
          /* file may not exist */
        }

        // Save to history using perfectly detected language
        addEntry({
          id: entryId ? String(entryId) : `res_${Date.now()}`,
          sourceLang: txResult.detectedLang,
          targetLang,
          transcript: txResult.transcript,
          translation: null,
          timestamp: Date.now(),
          duration: 0,
          sourceApp: 'ekwe',
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setHasPolished(true);
      } catch (err) {
        const error = err as Error;
        Alert.alert(
          'Transcription Failed',
          ErrorMessages[error.message as keyof typeof ErrorMessages] ??
            'Could not process the voice note.',
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [addEntry, sourceLang, targetLang, entryId, transcribe],
  );

  useEffect(() => {
    if (uri && !hasPolished && !isProcessing && !isReplay) {
      processSharedAudio(uri as string);
    }
  }, [uri, hasPolished, isProcessing, isReplay, processSharedAudio]);

  const handleTranslate = async (): Promise<void> => {
    if (!transcript) return;
    setIsTranslating(true);
    try {
      const trResult = await translate({
        text: transcript,
        sourceLang,
        targetLang,
      });

      setTranslation(trResult.translation);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Translation Failed', 'Try again in a moment.');
    } finally {
      setIsTranslating(false);
    }
  };

  return {
    transcript,
    translation,
    sourceLang,
    targetLang,
    isProcessing,
    hasPolished,
    isTranslating,
    isHistoryReplay: isReplay,
    handleTranslate,
  };
};
