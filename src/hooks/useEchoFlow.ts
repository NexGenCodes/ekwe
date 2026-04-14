import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useShareIntent } from 'expo-share-intent';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Platform, Linking } from 'react-native';

import EkweNative from '../../modules/ekwe-native';

import { useTranscription } from '@/hooks/api/useTranscription';
import { useTranslation } from '@/hooks/api/useTranslation';
import {
  useSharedAudioPlayer,
  preWarmAudioEngine,
} from '@/hooks/useSharedAudioPlayer';
import { supabase } from '@/lib/supabase';
import { AudioCapture } from '@/services/AudioCapture';
import { useSettingsStore, useHistoryStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { useSyncQueue } from '@/store/syncQueue';
import { EchoStep, EchoProps, UseEchoFlowResult } from '@/types/echo';
import { logger } from '@/utils';
import { cleanEchoCache } from '@/utils/echo';

/**
 * Resolves a content:// URI to a local file:// URI on Android.
 * On iOS or for file:// URIs, returns the URI as-is.
 */
async function resolveToFileUri(rawUri: string): Promise<string | null> {
  if (Platform.OS === 'android' && rawUri.startsWith('content://')) {
    return EkweNative.resolveContentUri(rawUri);
  }
  return rawUri;
}

export const useEchoFlow = (props: EchoProps): UseEchoFlowResult => {
  // Pre-warm the audio engine immediately — before language picker renders
  preWarmAudioEngine();

  const { resetShareIntent } = useShareIntent({
    disabled: Platform.OS === 'android',
  });
  const { targetLanguage, themePreference, onboardingCompleted } =
    useSettingsStore();

  // Read auth state synchronously via MMKV + Zustand
  const { isInitialized, session } = useAuthStore();

  // Initialize to undefined so the first incoming URI always triggers resolution
  const previousRawUri = useRef<string | undefined>(undefined);

  const isIOS = Platform.OS === 'ios';
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;

  // Resolved file:// URI — only set after content:// → file:// copy completes
  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const activeResolvedUri = useRef<string | undefined>(undefined);

  const mimeType = hasIOSFiles ? props.value![0].mimeType : props.mimeType;
  const sourceApp = isIOS ? 'iOS' : props.sourceApp || 'Unknown App';

  // State Machine
  const [step, setStep] = useState<EchoStep>('PickLanguage');
  const [selectedLang, setSelectedLang] = useState<string>('auto');
  const [transcription, setTranscription] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'Translation' | 'Transcription'>(
    'Translation',
  );

  // Audio Player — only receives a resolved file:// URI
  const player = useSharedAudioPlayer(audioUri || null);

  // Keep screen awake for the entire Echo session
  useEffect((): (() => void) => {
    activateKeepAwakeAsync('echoSession').catch(() => {});
    return () => {
      deactivateKeepAwake('echoSession')?.catch?.(() => {});
    };
  }, []);

  // ── URI Resolution Pipeline ──────────────────────────────────────────
  // Resolves content:// → file:// (cache copy), then feeds the file:// to the player.
  // On first mount this fires immediately. On subsequent intent changes it resets state.
  const { mutateAsync: transcribe } = useTranscription();
  const { mutateAsync: translate } = useTranslation();

  // "Cold Install" Guard
  useEffect((): void => {
    if (Platform.OS === 'android') {
      EkweNative.dismissNativeLoader();
    }

    const rawUri = hasIOSFiles ? props.value?.[0]?.value : props.audioUri;
    if (!rawUri) return;

    // Wait until Supabase Auth hydrates
    if (!isInitialized) return;

    // ── Cold Install Guard ───────────────────────────────────────────────
    // Block intent if the user has not completed onboarding or is not signed in
    if (!onboardingCompleted || !session) {
      if (Platform.OS === 'android') {
        EkweNative.dismissEcho();
        Linking.openURL('ekwe://');
      } else {
        resetShareIntent(true);
        Linking.openURL('ekwe://');
      }
      return;
    }

    // Guard: skip if we already resolved this exact raw URI
    if (rawUri === previousRawUri.current) return;
    const isSubsequentIntent = previousRawUri.current !== undefined;
    previousRawUri.current = rawUri;

    // Clean up previous session
    if (activeResolvedUri.current) {
      cleanEchoCache(activeResolvedUri.current);
    }

    const resolve = async (): Promise<void> => {
      setIsResolving(true);

      const fileUri = await resolveToFileUri(rawUri);

      if (!fileUri) {
        setIsResolving(false);
        Alert.alert('Error', 'Could not access the shared audio file.');
        return;
      }

      activeResolvedUri.current = fileUri;
      setAudioUri(fileUri);
      setIsResolving(false);

      // Only reset step/results for subsequent share intents, not on first mount
      if (isSubsequentIntent) {
        setStep('PickLanguage');
        setTranscription(null);
        setTranslation(null);
      }
    };

    resolve();
  }, [
    props.audioUri,
    hasIOSFiles,
    props.value,
    resetShareIntent,
    isInitialized,
    session,
    onboardingCompleted,
  ]);

  // Processing Logic
  const handleProcess = async (): Promise<void> => {
    if (!audioUri) return;

    Haptics.selectionAsync();
    setStep('Processing');
    try {
      EkweNative?.updateBubbleMode?.('MAGIC');
    } catch {}

    try {
      // Validate format, size, and sniff audio headers (all need file:// URI)
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
          durationMs: player.duration * 1000,
          averageDb: -40,
          trimStartMs: 0,
          trimEndMs: 0,
          hasSpeech: true,
          meteringData: player.realWaveform,
        },
        sourceLang: selectedLang as string,
      });

      setTranscription(txResult.transcript);

      // Translation Mutation
      const tLang = targetLanguage || 'en';
      let translationResultText = null;

      try {
        const trResult = await translate({
          text: txResult.transcript,
          sourceLang: txResult.detectedLang,
          targetLang: tLang,
        });
        translationResultText = trResult.translation;
        setTranslation(trResult.translation);
        setActiveTab('Translation');
      } catch {
        setTranslation('Translation failed. See transcription instead.');
        setActiveTab('Transcription');
      }

      // Record to history safely
      const historyEntry = {
        id: `echo_${Date.now()}`,
        sourceLang: txResult.detectedLang,
        targetLang: tLang,
        transcript: txResult.transcript,
        translation: translationResultText,
        timestamp: Date.now(),
        duration: player.duration,
        sourceApp,
      };

      useHistoryStore.getState().addEntry(historyEntry);

      // Feature: Sync history to Supabase if user is logged in natively
      if (session?.user) {
        logger.info('[Sync] Attempting to push history to Supabase...');
        const payload = {
          id: historyEntry.id,
          user_id: session.user.id,
          source_lang: historyEntry.sourceLang,
          target_lang: historyEntry.targetLang,
          transcript: historyEntry.transcript,
          translation_text: historyEntry.translation || null,
          duration: historyEntry.duration,
          source_app: historyEntry.sourceApp,
        };

        supabase
          .from('history')
          .insert(payload)
          .then(({ error }): void => {
            if (error) {
              logger.warn(
                '[Sync] Push failed, storing in Outbox Queue:',
                error.message,
              );
              useSyncQueue.getState().enqueue(payload);
            } else {
              logger.info('[Sync] Successfully synchronized history entry.');
            }
          });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('Result');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Processing Error', message);
      setStep('PickLanguage');
    } finally {
      try {
        EkweNative?.updateBubbleMode?.('IDLE');
      } catch {}
    }
  };

  const handleCopy = async (): Promise<void> => {
    Haptics.selectionAsync();
    const textToCopy =
      activeTab === 'Translation' ? translation : transcription;
    if (textToCopy) {
      await Clipboard.setStringAsync(textToCopy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const onDismiss = useCallback((): void => {
    if (activeResolvedUri.current) cleanEchoCache(activeResolvedUri.current);
    deactivateKeepAwake('echoSession')?.catch?.(() => {});
    if (Platform.OS === 'android') {
      EkweNative.dismissEcho();
    } else {
      resetShareIntent(true);
    }
  }, [resetShareIntent]);

  return {
    step,
    setStep,
    selectedLang,
    setSelectedLang,
    transcription,
    translation,
    activeTab,
    setActiveTab,
    audioUri,
    sourceApp,
    player,
    isResolving,
    themePreference,
    handleProcess,
    handleCopy,
    onDismiss,
  };
};
