import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useCallback, useReducer } from 'react';
import { Alert, Platform } from 'react-native';

import { useTranscription } from '@/hooks';
import { useTranslation } from '@/hooks';
import { useEchoIntentResolver } from '@/hooks';
import { preWarmAudioEngine } from '@/hooks';
import { AudioCapture } from '@/services/AudioCapture';
import { HistoryService } from '@/services/HistoryService';
import { IntentService } from '@/services/IntentService';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { EchoStep, EchoProps, UseEchoFlowResult } from '@/types/echo';
import { logger, AppAlert } from '@/utils';
import { cleanEchoCache } from '@/utils/echo';

interface EchoState {
  step: EchoStep;
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string;
  transcription: string | null;
  translation: string | null;
  sttProvider?: string;
  llmProvider?: string;
  audioDuration: number;
}

type EchoAction =
  | { type: 'SET_STEP'; payload: EchoStep }
  | { type: 'SET_SELECTED_LANG'; payload: string }
  | { type: 'SET_DETECTED_LANG'; payload: string | null }
  | { type: 'SET_TARGET_LANG'; payload: string }
  | { type: 'SET_TRANSCRIPTION'; payload: { text: string; provider?: string } }
  | { type: 'SET_TRANSLATION'; payload: { text: string; provider?: string } }
  | { type: 'SET_AUDIO_DURATION'; payload: number }
  | { type: 'RESET' };

const echoReducer = (state: EchoState, action: EchoAction): EchoState => {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.payload };
    case 'SET_SELECTED_LANG':
      return { ...state, selectedLang: action.payload };
    case 'SET_DETECTED_LANG':
      return { ...state, detectedLang: action.payload };
    case 'SET_TARGET_LANG':
      return { ...state, targetLang: action.payload };
    case 'SET_TRANSCRIPTION':
      return { ...state, transcription: action.payload.text, sttProvider: action.payload.provider };
    case 'SET_TRANSLATION':
      return { ...state, translation: action.payload.text, llmProvider: action.payload.provider };
    case 'SET_AUDIO_DURATION':
      return { ...state, audioDuration: action.payload };
    case 'RESET':
      return {
        ...state,
        step: 'PickLanguage',
        transcription: null,
        translation: null,
        detectedLang: null,
      };
    default:
      return state;
  }
};

export const useEchoFlow = (props: EchoProps): UseEchoFlowResult => {
  useEffect(() => {
    preWarmAudioEngine();
  }, []);

  const targetLanguage = useSettingsStore((s) => s.targetLanguage);
  const themePreference = useSettingsStore((s) => s.themePreference);
  const autoCopy = useSettingsStore((s) => s.autoCopy);
  const session = useAuthStore((s) => s.session);

  const isIOS = Platform.OS === 'ios';
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;
  const mimeType = hasIOSFiles ? props.value![0].mimeType : props.mimeType;
  const sourceApp = isIOS ? 'iOS' : props.sourceApp || 'Unknown App';

  // State Machine via Reducer
  const [state, dispatch] = useReducer(echoReducer, {
    step: 'PickLanguage',
    selectedLang: 'auto',
    detectedLang: null,
    targetLang: targetLanguage || 'en',
    transcription: null,
    translation: null,
    sttProvider: undefined,
    llmProvider: undefined,
    audioDuration: 0,
  });

  const setStep = useCallback((step: EchoStep) => dispatch({ type: 'SET_STEP', payload: step }), []);
  const setSelectedLang = useCallback((lang: string) => dispatch({ type: 'SET_SELECTED_LANG', payload: lang }), []);
  const setTargetLang = useCallback((lang: string) => dispatch({ type: 'SET_TARGET_LANG', payload: lang }), []);

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
      dispatch({ type: 'RESET' });
      setIsSubsequentIntent(false);
    }
  }, [isSubsequentIntent, setIsSubsequentIntent]);

  // Transcription Logic
  const handleTranscribe = async (
    durationSeconds: number,
    waveform: number[],
  ): Promise<void> => {
    dispatch({ type: 'SET_AUDIO_DURATION', payload: durationSeconds });
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
    logger.info('[EchoFlow] Selected Language:', state.selectedLang);

    if (!audioUri) return;

    Haptics.selectionAsync();
    dispatch({ type: 'SET_STEP', payload: 'Transcribing' });
    IntentService.updateBubbleMode('MAGIC');

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      AppAlert.error(
        'No Internet Connection',
        'Transcription requires an active internet connection. Please check your network and try again.',
      );
      dispatch({ type: 'SET_STEP', payload: 'Config' });
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
        sourceLang: state.selectedLang,
      });
      
      dispatch({ 
        type: 'SET_TRANSCRIPTION', 
        payload: { text: txResult.transcript, provider: txResult.provider } 
      });

      let finalLang = state.selectedLang;
      if (state.selectedLang === 'auto') {
        finalLang = txResult.detectedLang || 'en';
      } else {
        finalLang = state.selectedLang;
      }

      dispatch({ type: 'SET_DETECTED_LANG', payload: finalLang });

      // Auto-swap target language if it matches the detected source
      let finalTarget = state.targetLang;
      if (finalLang === state.targetLang) {
        const { selectedLanguages } = useSettingsStore.getState();
        finalTarget =
          selectedLanguages.find((l) => l !== finalLang) ||
          (finalLang === 'en' ? 'es' : 'en');
        dispatch({ type: 'SET_TARGET_LANG', payload: finalTarget });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      dispatch({ type: 'SET_STEP', payload: 'TranscribeResult' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Processing Error', message);
      dispatch({ type: 'SET_STEP', payload: 'PickLanguage' });
    } finally {
      IntentService.updateBubbleMode('IDLE');
    }
  };

  // Translation Logic
  const handleTranslate = async (): Promise<void> => {
    const textToTranslate = state.transcription;
    const source = state.detectedLang;
    const target = state.targetLang;
    const stt = state.sttProvider;

    logger.info('[EchoFlow] ── Initiating Translation ──');
    logger.info('[EchoFlow] Source:', source, '→ Target:', target);

    if (!textToTranslate || !source) return;

    Haptics.selectionAsync();
    dispatch({ type: 'SET_STEP', payload: 'Translating' });

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      AppAlert.error(
        'No Internet Connection',
        'Translation requires an active internet connection. Please check your network and try again.',
      );
      dispatch({ type: 'SET_STEP', payload: 'TranscribeResult' });
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
      dispatch({ 
        type: 'SET_TRANSLATION', 
        payload: { text: trResult.translation, provider: trResult.provider } 
      });

      if (autoCopy && translationResultText) {
        await Clipboard.setStringAsync(translationResultText);
      }
    } catch (e: unknown) {
      logger.error('Translate Error:', e);
      dispatch({ 
        type: 'SET_TRANSLATION', 
        payload: { text: `Translation failed (Error: ${String(e)}). Target: ${target}, Source: ${source}.` } 
      });
    }

    // Record to history safely using HistoryService
    await HistoryService.recordTranslation(
      {
        sourceLang: source,
        targetLang: target,
        transcript: textToTranslate,
        translation: translationResultText,
        duration: state.audioDuration,
        sourceApp,
        provider: stt || 'unknown',
      },
      session,
    );

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dispatch({ type: 'SET_STEP', payload: 'FullResult' });
  };

  const onDismiss = useCallback((): void => {
    if (activeResolvedUri.current) cleanEchoCache(activeResolvedUri.current);
    deactivateKeepAwake('echoSession')?.catch?.(() => { });
    IntentService.dismissEcho(resetShareIntent);
  }, [resetShareIntent]);

  return {
    step: state.step,
    setStep,
    selectedLang: state.selectedLang,
    setSelectedLang,
    detectedLang: state.detectedLang,
    targetLang: state.targetLang,
    setTargetLang,
    transcription: state.transcription,
    translation: state.translation,
    sttProvider: state.sttProvider,
    llmProvider: state.llmProvider,
    audioUri,
    sourceApp,
    isResolving,
    themePreference,
    handleTranscribe,
    handleTranslate,
    onDismiss,
  };
};
