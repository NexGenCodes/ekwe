import { useEventListener } from 'expo';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert, AppState, Platform, NativeModules } from 'react-native';

import { AudioCapture } from '@/services/AudioCapture';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';
import { useSettingsStore, useAudioStore, useHistoryStore } from '@/store';
import { BubbleNative } from '@/utils/BubbleModule';

const { EkweNative } = NativeModules;

// Standalone function to prevent stale closures in the component lifecycle
const handleEchoSession = async (uri: string, sourceApp: string = 'Unknown App') => {
  console.log(
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
    );

    if (transcriptionResult.ok) {
      const data = transcriptionResult.value;
      // 3. Chain Translation
      const targetLang = useSettingsStore.getState().targetLanguage || 'en';
      const translationResult = await TranslationService.translate(
        data.transcript,
        'auto',
        targetLang,
      );

      // 4. Persistence to History (Crucial: Background sessions must be saved)
      useHistoryStore.getState().addEntry({
        id: `echo_${Date.now()}`,
        sourceLang: data.sourceLang,
        targetLang: targetLang,
        transcript: data.transcript,
        translation: translationResult.ok ? translationResult.value.translation : null,
        timestamp: Date.now(),
        duration: data.durationSeconds,
        sourceApp: sourceApp
      });

      // 5. Dismiss Overlay 
      BubbleNative.dismissOverlay();
    } else {
      console.error('[EkweEcho] Background transcription failed');
    }
  } catch (err) {
    console.error('[EkweEcho] Fatal session error:', err);
  } finally {
    // Always release Wakelock
    deactivateKeepAwake('ekweEcho');
    // CLEANUP: Deleting the audio cache after processing is done
    EkweNative?.deleteFile(uri);
    BubbleNative.updateState('IDLE');
  }
};

export const useShareIntentHandler = (): void => {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const { onboardingCompleted, setOnboardingCompleted } = useSettingsStore();

  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent({
      disabled: Platform.OS === 'android',
    });

  useEffect(() => {
    if (error) {
      console.error('[ShareIntent] Error:', error);
    }
  }, [error]);

  // NATIVE QUEUE Bridge: Process intents intercepted by Ekwe Echo (ShareActivity)
  useEventListener(EkweNative, 'onIntentQueued', async (event: { audioPath: string; sourceApp: string }) => {
    console.log(`[ShareIntent] Native Intent Received: ${event.audioPath}`);
    
    const { onboardingCompleted } = useSettingsStore.getState();

    // GOTCHA 4: Prevent Echo transcription if the user isn't authenticated yet
    if (!onboardingCompleted) {
      console.warn('[ShareIntent] User not onboarded. Booting MainActivity visually.');
      BubbleNative.dismissOverlay();
      Alert.alert('Login Required', 'Please open Ekwe to log in before translating shared voice notes.');
      return;
    }

    let filePath = event.audioPath;
    if (Platform.OS === 'android' && filePath.startsWith('content://')) {
      const resolved = await BubbleNative.resolveContentUri(filePath);
      if (resolved) filePath = resolved;
    }

    const mimeType = 'audio/*'; 
    const isBackground = AppState.currentState !== 'active';

    const result = await AudioCapture.processSharedFile(
      filePath,
      mimeType,
    );

    if (result.ok) {
      if (Platform.OS === 'android' && isBackground) {
        handleEchoSession(result.value.uri, event.sourceApp);
      } else {
        useAudioStore
          .getState()
          .setOverlayState(
            true,
            undefined,
            result.value.uri,
            mimeType,
          );
      }
    } else {
      Alert.alert(
        'Unsupported Format',
        'Ekwe only supports voice note formats.',
        [{ text: 'Dismiss' }],
      );
      BubbleNative.dismissOverlay();
    }
  });

  useEffect(() => {
    // Wait for the navigation root to be mounted (only for foreground routing)
    const isBackground = AppState.currentState !== 'active';
    if (!navigationState?.key && !isBackground) return;

    if (hasShareIntent && shareIntent.type) {
      if (!onboardingCompleted) {
        console.warn('[ShareIntent] User not onboarded. Skipping share processing.');
        Alert.alert('Login Required', 'Please open Ekwe to log in before translating shared items.');
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
        const validFiles = shareIntent.files.filter(f => f && typeof f === 'object' && 'path' in f);
        if (validFiles.length === 0) return;

        const file = validFiles[0];
        resetShareIntent();

        const isBackground = AppState.currentState !== 'active';

        const processFile = async () => {
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
            if (Platform.OS === 'android' && isBackground) {
               BubbleNative.showOverlay(result.value.uri, 'Unknown App');
               handleEchoSession(result.value.uri, 'Unknown App');
            } else {
              useAudioStore
                .getState()
                .setOverlayState(
                  true,
                  undefined,
                  result.value.uri,
                  file.mimeType,
                );
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
    setOnboardingCompleted,
    resetShareIntent,
  ]);
};
