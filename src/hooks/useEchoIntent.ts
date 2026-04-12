import { useState, useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useAudioStore, useSettingsStore, useHistoryStore } from '@/store';
import { OverlayStep } from '@/store/audioSlice';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';

export function useEchoIntent(audioUri: string | null, duration: number, waveform: number[]) {
  const { setOverlayState, setSourceLang, sourceLang, overlaySourceApp } = useAudioStore();
  const { targetLanguage, autoCopy } = useSettingsStore();
  const { addEntry, updateEntry } = useHistoryStore();

  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);

  const handleTranscribe = async () => {
    if (!audioUri) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOverlayState(true, OverlayStep.Process);

    const audioData = {
      uri: audioUri,
      durationMs: duration * 1000,
      trimStartMs: 0,
      trimEndMs: 0,
      hasSpeech: true,
      averageDb: -20,
      meteringData: waveform,
    };

    const result = await TranscriptionService.transcribe(audioData, sourceLang || 'auto');

    if (result.ok) {
      const transcript = result.value.transcript;
      const historyId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      setTranscription(transcript);
      setSavedEntryId(historyId);
      setOverlayState(true, OverlayStep.Result);

      addEntry({
        id: historyId,
        sourceLang: sourceLang || 'auto',
        targetLang: targetLanguage || 'en',
        transcript,
        translation: null,
        timestamp: Date.now(),
        duration,
        sourceApp: overlaySourceApp || 'Shared',
      });

      if (autoCopy) {
        Clipboard.setStringAsync(transcript);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else {
      setOverlayState(true, OverlayStep.Pick);
    }
  };

  const handleTranslate = async () => {
    if (!transcription) return;
    setIsTranslating(true);

    const result = await TranslationService.translate(
      transcription,
      sourceLang || 'en',
      targetLanguage || 'en',
    );

    if (result.ok) {
      const translatedText = result.value.translation;
      setTranslation(translatedText);
      setShowTranslation(true);

      if (savedEntryId) {
        updateEntry(savedEntryId, { translation: translatedText });
      }
    }
    setIsTranslating(false);
  };

  return {
    transcription,
    translation,
    isTranslating,
    showTranslation,
    setShowTranslation,
    handleTranscribe,
    handleTranslate,
    setTranscription,
    setTranslation,
  };
}
