import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { EkweError, ErrorMessages } from '@/constants/errors';
import { usePermissions } from '@/hooks/usePermissions';
import { useMetering } from '@/hooks/audio/useMetering';
import { AudioCapture } from '@/services/AudioCapture';
import { AudioProcessor } from '@/services/AudioProcessor';
import { TranscriptionService } from '@/services/Transcription';
import { logger } from '@/utils';

// Timer resolution for elapsed display
const TIMER_TICK_MS = 100;

export type DictationStatus =
  | 'idle'
  | 'recording'
  | 'preview'
  | 'processing'
  | 'error';

export interface UseVoiceDictationReturn {
  status: DictationStatus;
  amplitude: SharedValue<number>;
  elapsedMs: number;
  maxDurationMs: number;
  error: string | null;
  capturedUri: string | null;
  startDictation: (sourceLang: string) => Promise<void>;
  stopDictation: () => Promise<string | null>;
  confirmDictation: (sourceLang: string) => Promise<string | null>;
  cancelDictation: () => Promise<void>;
}

export function useVoiceDictation(): UseVoiceDictationReturn {
  const permissions = usePermissions();
  const maxDurationMs = permissions.dictationDurationMs;

  const [status, _setStatus] = useState<DictationStatus>('idle');
  const statusRef = useRef<DictationStatus>('idle');
  const setStatus = (s: DictationStatus): void => {
    statusRef.current = s;
    _setStatus(s);
  };

  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Real-time amplitude SharedValue driven by AudioCapture at ~60fps on the UI thread.
  // useMetering subscribes to AudioCapture.addListener() — zero React re-renders for waveform.
  const amplitude = useMetering();

  // Refs to hold mutable values that shouldn't trigger re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sourceLangRef = useRef<string>('auto');
  const elapsedMsRef = useRef(0);
  const capturedUriRef = useRef<string | null>(null);
  const capturedMeteringRef = useRef<number[]>([]);
  const capturedDurationRef = useRef<number>(0);

  // stopDictation ref — keeps the timeout closure pointing to latest version
  const stopDictationRef = useRef<() => Promise<string | null>>(
    async () => null,
  );

  // --- Cleanup all timers (pure ref mutation, no re-render) ---
  const clearTimers = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (maxDurationTimeoutRef.current !== null) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
  }, []);

  // --- Sync with native status changes (e.g. silence auto-stop) ---
  useEffect(() => {
    return AudioCapture.addStatusListener((s) => {
      if (s === 'stopped' && statusRef.current === 'recording') {
        logger.info(
          '[VoiceDictation] Native recorder stopped externally (silence or cap), syncing...',
        );
        stopDictationRef.current();
      }
    });
  }, [clearTimers]);

  // --- Full cleanup on unmount ---
  useEffect(() => {
    return (): void => {
      clearTimers();
      abortControllerRef.current?.abort();
      if (AudioCapture.isRecording()) {
        AudioCapture.cancelRecording().catch(() => { });
      }
    };
  }, [clearTimers]);

  // --- Stop recording and enter preview ---
  const stopDictation = useCallback(async (): Promise<string | null> => {
    if (statusRef.current !== 'recording' || !AudioCapture.isRecording()) {
      if (statusRef.current === 'recording') {
        logger.warn('[VoiceDictation] stopDictation called but not recording');
        setStatus('idle');
      }
      return null;
    }

    clearTimers();
    logger.info('[VoiceDictation] Stopping recording, entering preview');

    // 1. Stop the native recorder
    const captureResult = await AudioCapture.stopRecording();
    if (!captureResult.ok) {
      const msg = ErrorMessages[captureResult.error] ?? 'Recording failed.';
      logger.error(
        '[VoiceDictation] stopRecording failed:',
        captureResult.error,
      );
      setError(msg);
      setStatus('error');
      return null;
    }

    const { uri, durationMs, meteringData } = captureResult.value;
    capturedUriRef.current = uri;
    capturedMeteringRef.current = meteringData;
    capturedDurationRef.current = durationMs;

    setStatus('preview');
    return uri;
  }, [clearTimers]);

  // --- Confirm preview and send for transcription ---
  const confirmDictation = useCallback(
    async (sourceLang: string): Promise<string | null> => {
      const uri = capturedUriRef.current;
      if (!uri || statusRef.current !== 'preview') {
        logger.warn(
          '[VoiceDictation] confirmDictation called without valid preview',
        );
        return null;
      }

      setStatus('processing');
      let processedUri: string | null = null;

      try {
        logger.info('[VoiceDictation] Confirming dictation, uri:', uri);

        // 2. Validate & trim audio
        const processResult = await AudioProcessor.processRecording(
          uri,
          capturedDurationRef.current,
          capturedMeteringRef.current,
        );

        if (!processResult.ok) {
          const msg =
            ErrorMessages[processResult.error] ?? 'Audio processing failed.';
          logger.error(
            '[VoiceDictation] processRecording failed:',
            processResult.error,
          );
          setError(msg);
          setStatus('error');
          return null;
        }

        processedUri = processResult.value.uri;

        // 3. Send to /transcribe
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Use the live sourceLang passed at confirm-time, not the stale ref from record-time.
        // This ensures language changes made in the preview state are respected.
        logger.info('[VoiceDictation] Transcribing with lang:', sourceLang);
        const transcribeResult = await TranscriptionService.transcribe(
          processResult.value,
          sourceLang,
          controller.signal,
        );

        abortControllerRef.current = null;

        if (!transcribeResult.ok) {
          if (controller.signal.aborted) {
            logger.info('[VoiceDictation] Transcription aborted');
            return null;
          }
          const msg =
            ErrorMessages[transcribeResult.error] ?? 'Transcription failed.';
          logger.error(
            '[VoiceDictation] Transcription failed:',
            transcribeResult.error,
          );
          setError(msg);
          setStatus('error');
          return null;
        }

        const { transcript } = transcribeResult.value;
        logger.info('[VoiceDictation] Transcription success');

        setStatus('idle');
        setElapsedMs(0);
        elapsedMsRef.current = 0;
        capturedUriRef.current = null;
        return transcript;
      } catch (err) {
        logger.error('[VoiceDictation] Confirm error:', err);
        setError('Failed to process voice input.');
        setStatus('error');
        return null;
      } finally {
        // --- ALWAYS Cleanup audio files ---
        try {
          if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
          if (processedUri && processedUri !== uri) {
            await FileSystem.deleteAsync(processedUri, { idempotent: true });
          }
          logger.info('[VoiceDictation] Cleaned up temporary audio files');
        } catch (e) {
          logger.error('[VoiceDictation] Cleanup error:', e);
        }
      }
    },
    [],
  );

  // Keep stopDictationRef current so the maxDuration timeout always calls the latest version
  useEffect(() => {
    stopDictationRef.current = stopDictation;
  }, [stopDictation]);

  // --- Start dictation ---
  const startDictation = useCallback(
    async (sourceLang: string): Promise<void> => {
      // Auto-recover from stale states on new attempt
      if (statusRef.current === 'error' || statusRef.current === 'preview') {
        // Cleanup any preview file before resetting
        if (capturedUriRef.current) {
          FileSystem.deleteAsync(capturedUriRef.current, {
            idempotent: true,
          }).catch(() => { });
          capturedUriRef.current = null;
        }
        setStatus('idle');
        setError(null);
      }

      if (statusRef.current !== 'idle') {
        logger.warn(
          '[VoiceDictation] startDictation called while status is:',
          statusRef.current,
        );
        return;
      }

      logger.info(
        '[VoiceDictation] Starting dictation, lang:',
        sourceLang,
        'permissions:',
        permissions,
      );
      sourceLangRef.current = sourceLang;
      setError(null);
      elapsedMsRef.current = 0;
      setElapsedMs(0);

      // Request microphone permission (shows OS prompt if needed)
      const permResult = await AudioCapture.requestPermission();
      if (!permResult.ok) {
        logger.warn('[VoiceDictation] Microphone permission denied');
        setError(ErrorMessages[EkweError.PERMISSION_MIC]);
        setStatus('error');
        return;
      }

      // Start native recording (attaches Android audio effects: NS, EC, AGC)
      const sessionId = Crypto.randomUUID();
      const startResult = await AudioCapture.startRecording(
        sessionId,
        stopDictationRef.current,
      );
      if (!startResult.ok) {
        logger.error(
          '[VoiceDictation] startRecording failed:',
          startResult.error,
        );
        setError(
          ErrorMessages[startResult.error] ??
          ErrorMessages[EkweError.AUDIO_RECORD_FAIL],
        );
        setStatus('error');
        return;
      }

      setStatus('recording');
      logger.info(
        '[VoiceDictation] Recording started, maxDuration:',
        maxDurationMs,
        'ms',
      );

      // Elapsed counter (100ms ticks for smooth countdown display)
      timerIntervalRef.current = setInterval(() => {
        elapsedMsRef.current += TIMER_TICK_MS;
        setElapsedMs(elapsedMsRef.current);
      }, TIMER_TICK_MS);

      // Hard cap — auto-stop when max duration is reached
      maxDurationTimeoutRef.current = setTimeout(() => {
        logger.info('[VoiceDictation] Max duration reached, auto-stopping');
        stopDictationRef.current();
      }, maxDurationMs);
    },
    [maxDurationMs, permissions],
  );

  // --- Cancel dictation ---
  const cancelDictation = useCallback(async (): Promise<void> => {
    logger.info(
      '[VoiceDictation] Cancelling dictation, status:',
      statusRef.current,
    );
    clearTimers();

    // Abort any in-flight transcription fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Cancel native recording and cleanup partial file
    if (AudioCapture.isRecording()) {
      const cancelResult = await AudioCapture.cancelRecording();
      if (cancelResult.ok && cancelResult.value) {
        try {
          await FileSystem.deleteAsync(cancelResult.value, {
            idempotent: true,
          });
          logger.info(
            '[VoiceDictation] Cleaned up partial recording:',
            cancelResult.value,
          );
        } catch (e) {
          logger.error(
            '[VoiceDictation] Failed to cleanup partial recording:',
            e,
          );
        }
      }
    }

    // Cleanup any preview file
    if (capturedUriRef.current) {
      FileSystem.deleteAsync(capturedUriRef.current, {
        idempotent: true,
      }).catch(() => { });
      capturedUriRef.current = null;
    }

    setStatus('idle');
    setError(null);
    setElapsedMs(0);
    elapsedMsRef.current = 0;
  }, [clearTimers]);

  return {
    status,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error,
    capturedUri: capturedUriRef.current,
    startDictation,
    stopDictation,
    confirmDictation,
    cancelDictation,
  };
}
