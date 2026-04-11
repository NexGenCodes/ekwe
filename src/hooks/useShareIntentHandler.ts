import { useRouter, useRootNavigationState } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { AudioCapture } from '@/services/AudioCapture';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';
import { useSettingsStore, useAudioStore } from '@/store';
import { BubbleNative } from '@/utils/BubbleModule';

// Standalone function to prevent stale closures in the component lifecycle
const handleGhostMode = async (uri: string) => {
  console.log(
    '[GhostMode] App in background — performing background transcription',
  );

  // 1. Instant Feedback: Show "MAGIC" state (sparkles) so user knows it started
  BubbleNative.updateState('MAGIC');
  useAudioStore.getState().setActiveFloatingHead('card');

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
    // 3. Chain Translation
    const targetLang = useSettingsStore.getState().targetLanguage || 'en';
    const translationResult = await TranslationService.translate(
      transcriptionResult.value.transcript,
      'auto',
      targetLang,
    );

    // 4. Trigger Native Window with both results
    BubbleNative.showFloatingCard(
      transcriptionResult.value.transcript,
      translationResult.ok
        ? translationResult.value.translation
        : transcriptionResult.value.transcript,
    );
  } else {
    console.error('[GhostMode] Background transcription failed');
    useAudioStore.getState().setActiveFloatingHead('none');
    BubbleNative.updateState('IDLE');
  }
};

export const useShareIntentHandler = (): void => {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const { onboardingCompleted, setOnboardingCompleted } = useSettingsStore();

  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent();

  useEffect(() => {
    if (error) {
      console.error('[ShareIntent] Error:', error);
    }
  }, [error]);

  useEffect(() => {
    // Wait for the navigation root to be mounted
    if (!navigationState?.key) return;

    if (hasShareIntent && shareIntent.type) {
      // Pro Flow: Bypass onboarding
      if (!onboardingCompleted) {
        setOnboardingCompleted(true);
      }

      if (shareIntent.type === 'text' && shareIntent.text) {
        router.push({
          pathname: '/translate',
          params: {
            text: shareIntent.text,
            detectedLang: 'en', // default or use logic
          },
        });
        resetShareIntent();
      } else if (shareIntent.type === 'file' && shareIntent.files?.[0]) {
        const file = shareIntent.files[0];
        resetShareIntent();

        // Ghost Mode Decision — Use AppState to decide UI path
        const isBackground = AppState.currentState !== 'active';

        const processFile = async () => {
          let filePath = file.path;

          // ANDROID FIX: Resolve content:// URI to standard file path
          if (Platform.OS === 'android' && filePath.startsWith('content://')) {
            const resolved = await BubbleNative.resolveContentUri(filePath);
            if (resolved) filePath = resolved;
          }

          const result = await AudioCapture.processSharedFile(
            filePath,
            file.mimeType,
          );

          if (result.ok) {
            // On Android + Background -> Trigger Native Ghost Card
            if (Platform.OS === 'android' && isBackground) {
              handleGhostMode(result.value.uri);
            } else {
              // Foreground or iOS -> Use high-fidelity RN Overlay
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
