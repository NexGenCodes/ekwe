import { useEventListener } from 'expo';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import EkweNative from '../../modules/ekwe-native';

import { AudioCapture } from '@/services/AudioCapture';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';
import { useSettingsStore, useAudioStore, useHistoryStore } from '@/store';
import { logger } from '@/utils';
import { BubbleNative } from '@/utils/BubbleModule';

// Module-level abort controller for background echo sessions
let echoSessionAbort: AbortController | null = null;

// Standalone function to prevent stale closures in the component lifecycle
const handleEchoSession = async (
  uri: string,
  sourceApp: string = 'Unknown App',
): Promise<void> => {
  // Cancel any previous background session
  echoSessionAbort?.abort();
  echoSessionAbort = new AbortController();
  const signal = echoSessionAbort.signal;

  logger.info(
    `[EkweEcho] App in background — transcribing voice from ${sourceApp}`,
  );

  try {
    // 1. Instant Feedback: Show "MAGIC" state (sparkles) so user knows it started
    BubbleNative.updateState('MAGIC');
    useAudioStore.getState().setActiveFloatingHead('card');

    // GOTCHA 3: Prevent Nitro / CPU Thread Throttling
    await activateKeepAwakeAsync('ekweEcho');

    // Settings Sync: Rehydrate store to get latest language in this separate process
    await useSettingsStore.persist.rehydrate();

    // 2. Perform background transcription
    const transcriptionResult = await TranscriptionService.transcribe(
      {
        uri,
        durationMs: 0,
        averageDb: -40,
        trimStartMs: 0,
        trimEndMs: 0,
        hasSpeech: true,
        meteringData: [],
      },
      'auto',
      signal,
    );

    if (signal.aborted) return;

    if (transcriptionResult.ok) {
      const data = transcriptionResult.value;
      // 3. Chain Translation
      const targetLang = useSettingsStore.getState().targetLanguage || 'en';
      const translationResult = await TranslationService.translate(
        data.transcript,
        'auto',
        targetLang,
        signal,
      );

      if (signal.aborted) return;

      // 4. Persistence to History (Crucial: Background sessions must be saved)
      useHistoryStore.getState().addEntry({
        id: `echo_${Date.now()}`,
        sourceLang: data.sourceLang,
        targetLang,
        transcript: data.transcript,
        translation: translationResult.ok
          ? translationResult.value.translation
          : null,
        timestamp: Date.now(),
        duration: data.durationSeconds,
        sourceApp,
      });

      // 5. Dismiss Overlay
      BubbleNative.dismissOverlay();
    } else {
      logger.error('[EkweEcho] Background transcription failed');
    }
  } catch (err) {
    logger.error('[EkweEcho] Fatal session error:', err);
  } finally {
    // Always release Wakelock
    try {
      deactivateKeepAwake('ekweEcho');
    } catch {
      /* Activity may be destroyed */
    }
    // CLEANUP: Deleting the audio cache after processing is done
    EkweNative?.deleteFile(uri);
    BubbleNative.updateState('IDLE');
  }
};

export const useShareIntentHandler = (): void => {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const { onboardingCompleted } = useSettingsStore();

  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent({
      disabled: Platform.OS === 'android',
    });

  useEffect((): void => {
    if (error) {
      logger.error('[ShareIntent] Error:', error);
    }
  }, [error]);

  // NATIVE QUEUE Bridge: Process intents intercepted by Ekwe Echo (ShareActivity)
  useEventListener(
    EkweNative,
    'onIntentQueued',
    async (event: { audioPath: string; sourceApp: string }): Promise<void> => {
      logger.info(`[ShareIntent] Native Intent Received: ${event.audioPath}`);

      let filePath = event.audioPath;
      if (Platform.OS === 'android' && filePath.startsWith('content://')) {
        const resolved = await BubbleNative.resolveContentUri(filePath);
        if (resolved) filePath = resolved;
      }

      const mimeType = 'audio/*';
      const isBackground = AppState.currentState !== 'active';

      const result = await AudioCapture.processSharedFile(filePath, mimeType);

      if (result.ok) {
        if (Platform.OS === 'android' && isBackground) {
          handleEchoSession(result.value.uri, event.sourceApp);
        } else {
          router.push({
            pathname: '/result',
            params: { uri: result.value.uri },
          });
        }
      } else {
        Alert.alert(
          'Unsupported Format',
          'Ekwe only supports voice note formats.',
          [{ text: 'Dismiss' }],
        );
        BubbleNative.dismissOverlay();
      }
    },
  );

  useEffect((): void => {
    // Wait for the navigation root to be mounted (only for foreground routing)
    const isBackground = AppState.currentState !== 'active';
    if (!navigationState?.key && !isBackground) return;

    if (hasShareIntent && shareIntent.type) {
      if (!onboardingCompleted) {
        logger.warn(
          '[ShareIntent] User not onboarded. Skipping share processing.',
        );
        Alert.alert(
          'Login Required',
          'Please open Ekwe to log in before translating shared items.',
        );
        resetShareIntent();
        return;
      }

      if (shareIntent.type === 'text' && shareIntent.text) {
        router.push({
          pathname: '/translate',
          params: {
            text: shareIntent.text,
            detectedLang: 'en',
          },
        });
        resetShareIntent();
      } else if (shareIntent.type === 'file' && shareIntent.files) {
        const validFiles = shareIntent.files.filter(
          (f) => f && typeof f === 'object' && 'path' in f,
        );
        if (validFiles.length === 0) return;

        const file = validFiles[0];
        resetShareIntent();

        const isBackgroundApp = AppState.currentState !== 'active';

        const processFile = async (): Promise<void> => {
          let filePath = file.path;

          if (Platform.OS === 'android' && filePath.startsWith('content://')) {
            const resolved = await BubbleNative.resolveContentUri(filePath);
            if (resolved) filePath = resolved;
          }

          const result = await AudioCapture.processSharedFile(
            filePath,
            file.mimeType,
          );

          if (result.ok) {
            if (Platform.OS === 'android' && isBackgroundApp) {
              BubbleNative.showOverlay(result.value.uri, 'Unknown App');
              handleEchoSession(result.value.uri, 'Unknown App');
            } else {
              router.push({
                pathname: '/result',
                params: { uri: result.value.uri },
              });
            }
          } else {
            Alert.alert(
              'Unsupported Format',
              'Ekwe only supports voice note formats (.opus, .m4a, .ogg).',
              [{ text: 'Dismiss' }],
            );
          }
        };

        processFile();
      }
    }
  }, [
    hasShareIntent,
    shareIntent,
    router,
    navigationState?.key,
    onboardingCompleted,
    resetShareIntent,
  ]);
};
