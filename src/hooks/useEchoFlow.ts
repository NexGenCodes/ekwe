import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useState, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';

import { useTranscription } from '@/hooks/api/useTranscription';
import { useTranslation } from '@/hooks/api/useTranslation';
import { useEchoIntentResolver } from '@/hooks/useEchoIntentResolver';
import { preWarmAudioEngine } from '@/hooks/useSharedAudioPlayer';
import { AudioCapture } from '@/services/AudioCapture';
import { HistoryService } from '@/services/HistoryService';
import { IntentService } from '@/services/IntentService';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { EchoStep, EchoProps, UseEchoFlowResult } from '@/types/echo';
import { logger, AppAlert } from '@/utils';
import { cleanEchoCache } from '@/utils/echo';

export const useEchoFlow = (props: EchoProps): UseEchoFlowResult => {
  useEffect(() => {
    preWarmAudioEngine();
  }, []);

  const { targetLanguage, themePreference, autoCopy } = useSettingsStore();
  const { session } = useAuthStore();

  const isIOS = Platform.OS === 'ios';
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;
  const mimeType = hasIOSFiles ? props.value![0].mimeType : props.mimeType;
  const sourceApp = isIOS ? 'iOS' : props.sourceApp || 'Unknown App';

  // State Machine
  const [step, setStep] = useState<EchoStep>('PickLanguage');
  const [selectedLang, setSelectedLang] = useState<string>('auto');
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<string>(targetLanguage || 'en');
  const [transcription, setTranscription] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sttProvider, setSttProvider] = useState<string>();
  const [llmProvider, setLlmProvider] = useState<string>();
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Keep screen awake for the entire Echo session
  useEffect((): (() => void) => {
    activateKeepAwakeAsync('echoSession').catch(() => { });
    return () => {
      deactivateKeepAwake('echoSession')?.catch?.(() => { });
    };
  }, []);

  // API mutations
  const { mutateAsync: transcribe } = useTranscription();
  const { mutateAsync: translate } = useTranslation();

  // ── URI Resolution Pipeline ──────────────────────────────────────────
  const {
    audioUri,
    isResolving,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
    resetShareIntent,
  } = useEchoIntentResolver(props);

  // Reset state on subsequent share intents
  useEffect(() => {
    if (isSubsequentIntent) {
      setStep('PickLanguage');
      setTranscription(null);
      setTranslation(null);
      setIsSubsequentIntent(false);
    }
  }, [isSubsequentIntent, setIsSubsequentIntent]);

  // Transcription Logic
  const handleTranscribe = async (
    durationSeconds: number,
    waveform: number[],
  ): Promise<void> => {
    setAudioDuration(durationSeconds);
    logger.info('[EchoFlow] ── Initiating Transcription ──');
    logger.info('[EchoFlow] User ID:', session?.user?.id);
    logger.info(
      '[EchoFlow] app_metadata:',
      JSON.stringify(session?.user?.app_metadata),
    );
    logger.info(
      '[EchoFlow] is_pro:',
      session?.user?.app_metadata?.is_pro ?? 'MISSING',
    );
    logger.info('[EchoFlow] Selected Language:', selectedLang);

    if (!audioUri) return;

    Haptics.selectionAsync();
    setStep('Transcribing');
    IntentService.updateBubbleMode('MAGIC');

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      AppAlert.error(
        'No Internet Connection',
        'Transcription requires an active internet connection. Please check your network and try again.',
      );
      setStep('Config');
      IntentService.updateBubbleMode('IDLE');
      return;
    }

    try {
      // Validate format, size, and sniff audio headers
      const fileResult = await AudioCapture.processSharedFile(
        audioUri,
        mimeType || 'audio/*',
      );
      if (!fileResult.ok) throw new Error('Unsupported Audio Format');
      const safeUri = fileResult.value.uri;

      // Transcription Mutation
      const txResult = await transcribe({
        audio: {
          uri: safeUri,
          durationMs: durationSeconds * 1000,
          averageDb: -40,
          trimStartMs: 0,
          trimEndMs: 0,
          hasSpeech: true,
          meteringData: waveform,
        },
        sourceLang: selectedLang,
      });
      setTranscription(txResult.transcript);
      if (txResult.provider) setSttProvider(txResult.provider);

      let finalLang = selectedLang;
      if (selectedLang === 'auto') {
        finalLang = txResult.detectedLang || 'en';
      } else {
        finalLang = selectedLang;
      }

      setDetectedLang(finalLang);

      // Auto-swap target language if it matches the detected source
      let finalTarget = targetLang;
      if (finalLang === targetLang) {
        const { selectedLanguages } = useSettingsStore.getState();
        finalTarget =
          selectedLanguages.find((l) => l !== finalLang) ||
          (finalLang === 'en' ? 'es' : 'en');
        setTargetLang(finalTarget);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setStep('TranscribeResult');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Processing Error', message);
      setStep('PickLanguage');
    } finally {
      IntentService.updateBubbleMode('IDLE');
    }
  };

  // Translation Logic
  const handleTranslate = async (): Promise<void> => {
    const textToTranslate = transcription;
    const source = detectedLang;
    const target = targetLang;
    const stt = sttProvider;

    logger.info('[EchoFlow] ── Initiating Translation ──');
    logger.info('[EchoFlow] Source:', source, '→ Target:', target);

    if (!textToTranslate || !source) return;

    Haptics.selectionAsync();
    setStep('Translating');

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      AppAlert.error(
        'No Internet Connection',
        'Translation requires an active internet connection. Please check your network and try again.',
      );
      setStep('TranscribeResult');
      return;
    }

    let translationResultText = null;

    try {
      const trResult = await translate({
        text: textToTranslate,
        sourceLang: source,
        targetLang: target,
      });
      translationResultText = trResult.translation;
      setTranslation(trResult.translation);
      if (trResult.provider) setLlmProvider(trResult.provider);

      if (autoCopy && translationResultText) {
        await Clipboard.setStringAsync(translationResultText);
      }
    } catch (e: unknown) {
      logger.error('Translate Error:', e);
      setTranslation(
        `Translation failed (Error: ${String(e)}). Target: ${target}, Source: ${source}.`,
      );
    }

    // Record to history safely using HistoryService
    await HistoryService.recordTranslation(
      {
        sourceLang: source,
        targetLang: target,
        transcript: textToTranslate,
        translation: translationResultText,
        duration: audioDuration,
        sourceApp,
        provider: stt || 'unknown',
      },
      session,
    );

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('FullResult');
  };

  const onDismiss = useCallback((): void => {
    if (activeResolvedUri.current) cleanEchoCache(activeResolvedUri.current);
    deactivateKeepAwake('echoSession')?.catch?.(() => { });
    IntentService.dismissEcho(resetShareIntent);
  }, [resetShareIntent]);

  return {
    step,
    setStep,
    selectedLang,
    setSelectedLang,
    detectedLang,
    targetLang,
    setTargetLang,
    transcription,
    translation,
    sttProvider,
    llmProvider,
    audioUri,
    sourceApp,
    isResolving,
    themePreference,
    handleTranscribe,
    handleTranslate,
    onDismiss,
  };
};
