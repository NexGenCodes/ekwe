import { useSelector } from '@legendapp/state/react';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useCallback, useReducer } from 'react';
import { Platform, AppState } from 'react-native';

import { useEchoIntentResolver } from './useEchoIntentResolver';
import { preWarmAudioEngine } from '../audio/useSharedAudioPlayer';

import { useTranscription } from '@/hooks/api/useTranscription';
import { useTranslation } from '@/hooks/api/useTranslation';
import { HistoryService } from '@/services/HistoryService';
import { IntentService } from '@/services/IntentService';
import { settings$, auth$ } from '@/store';
import { EchoStep, EchoProps, UseEchoFlowResult } from '@/types/echo';
import { logger } from '@/utils';
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
  error: string | null;
}

type EchoAction =
  | { type: 'SET_STEP'; payload: EchoStep }
  | { type: 'SET_SELECTED_LANG'; payload: string }
  | { type: 'SET_DETECTED_LANG'; payload: string | null }
  | { type: 'SET_TARGET_LANG'; payload: string }
  | { type: 'SET_TRANSCRIPTION'; payload: { text: string; provider?: string } }
  | {
      type: 'SET_TRANSLATION';
      payload: { text: string | null; provider?: string };
    }
  | { type: 'SET_AUDIO_DURATION'; payload: number }
  | { type: 'SET_ERROR'; payload: string | null }
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
      return {
        ...state,
        transcription: action.payload.text,
        sttProvider: action.payload.provider,
      };
    case 'SET_TRANSLATION':
      return {
        ...state,
        translation: action.payload.text,
        llmProvider: action.payload.provider,
      };
    case 'SET_AUDIO_DURATION':
      return { ...state, audioDuration: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
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

  const themePreference = useSelector(() => settings$.themePreference.get());
  const autoCopy = useSelector(() => settings$.autoCopy.get());
  const session = useSelector(() => auth$.session.get());

  const isIOS = Platform.OS === 'ios';
  const sourceApp = isIOS ? 'iOS' : props.sourceApp || 'Unknown App';

  // State Machine via Reducer
  const [state, dispatch] = useReducer(echoReducer, {
    step: 'PickLanguage',
    selectedLang: 'auto',
    detectedLang: null,
    targetLang: '',
    transcription: null,
    translation: null,
    sttProvider: undefined,
    llmProvider: undefined,
    audioDuration: 0,
    error: null,
  });

  const setStep = useCallback(
    (step: EchoStep) => dispatch({ type: 'SET_STEP', payload: step }),
    [],
  );
  const setSelectedLang = useCallback(
    (lang: string) => dispatch({ type: 'SET_SELECTED_LANG', payload: lang }),
    [],
  );
  const setTargetLang = useCallback(
    (lang: string) => dispatch({ type: 'SET_TARGET_LANG', payload: lang }),
    [],
  );

  // Keep screen awake for the entire Echo session
  useEffect((): (() => void) => {
    activateKeepAwakeAsync('echoSession').catch(() => {});
    return () => {
      deactivateKeepAwake('echoSession')?.catch?.(() => {});
    };
  }, []);

  // API mutations via React Query
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
      dispatch({
        type: 'SET_ERROR',
        payload: 'Transcription requires an active internet connection.',
      });
      dispatch({ type: 'SET_STEP', payload: 'Error' });
      IntentService.updateBubbleMode('IDLE');
      return;
    }

    try {
      // Audio is already decoded and pre-warmed during the Intent Resolution phase
      const safeUri = audioUri;

      // Transcription Mutation via React Query
      const trResult = await transcribe({
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

      const detectedLang = trResult.detectedLang;

      dispatch({
        type: 'SET_TRANSCRIPTION',
        payload: { text: trResult.transcript, provider: trResult.provider },
      });

      let finalLang = state.selectedLang;
      if (state.selectedLang === 'auto') {
        finalLang = detectedLang || 'en';
      } else {
        finalLang = state.selectedLang;
      }

      dispatch({ type: 'SET_DETECTED_LANG', payload: finalLang });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch({ type: 'SET_STEP', payload: 'TranscribeResult' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[EchoFlow] Transcription Error:', message);
      dispatch({ type: 'SET_ERROR', payload: message });
      dispatch({ type: 'SET_STEP', payload: 'Error' });
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
    // Clear old translation immediately to prevent "brief text flash"
    dispatch({ type: 'SET_TRANSLATION', payload: { text: null } });
    dispatch({ type: 'SET_STEP', payload: 'Translating' });

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      dispatch({
        type: 'SET_ERROR',
        payload: 'Translation requires an active internet connection.',
      });
      dispatch({ type: 'SET_STEP', payload: 'Error' });
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
        payload: {
          text: translationResultText,
          provider: trResult.provider,
        },
      });

      if (autoCopy && translationResultText) {
        await Clipboard.setStringAsync(translationResultText);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      logger.error('Translate Error:', message);
      dispatch({ type: 'SET_ERROR', payload: message });
      dispatch({ type: 'SET_STEP', payload: 'Error' });
      return; // Stop flow on translation error
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
    deactivateKeepAwake('echoSession')?.catch?.(() => {});
    IntentService.dismissEcho(resetShareIntent);
  }, [resetShareIntent]);

  // Clean up and dismiss if the user minimizes the app (backgrounds it)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        logger.info(
          '[EchoFlow] App state changed to background/inactive, dismissing echo...',
        );
        onDismiss();
      }
    });

    return (): void => {
      subscription.remove();
    };
  }, [onDismiss]);

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
    audioDuration: state.audioDuration,
    error: state.error,
    onDismiss,
  };
};
