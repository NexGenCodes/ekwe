import { useSelector } from '@legendapp/state/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import { HistoryService } from '@/services/HistoryService';
import {
  TranscriptionService,
  TranscriptionResult,
} from '@/services/Transcription';
import {
  audio$,
  audioActions,
  settings$,
  auth$,
  RecordingState,
} from '@/store';
import { Result, ok, err } from '@/types/Result';
import { logger } from '@/utils';

export interface UseTranscriptionReturn {
  transcribe: (
    audio: ProcessedAudio,
    overrideLang?: string,
  ) => Promise<Result<TranscriptionResult, EkweError>>;
  cancelTranscription: () => void;
  isTranscribing: boolean;
  detectedLang: string | null;
  mismatch: { detected: string; suggested: string } | null;
}

export const useTranscription = (): UseTranscriptionReturn => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{
    detected: string;
    suggested: string;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const sourceLang = useSelector(() => audio$.sourceLang.get());
  const sessionId = useSelector(() => audio$.sessionId.get());
  const userSession = useSelector(() => auth$.session.get());
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const { setError, appendTranscript, setRecordingState } = audioActions;

  const cancelTranscription = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranscribing(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return (): void => {
      cancelTranscription();
    };
  }, [cancelTranscription]);

  const transcribe = useCallback(
    async (
      audio: ProcessedAudio,
      overrideLang?: string,
    ): Promise<Result<TranscriptionResult, EkweError>> => {
      // Cancel previous if any
      cancelTranscription();

      setIsTranscribing(true);
      setMismatch(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const lang = overrideLang ?? sourceLang ?? selectedLanguages[0] ?? 'en';

      try {
        const result = await TranscriptionService.transcribe(
          audio,
          lang,
          controller.signal,
        );

        // Clear controller if we finished naturally
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }

        setIsTranscribing(false);

        if (!result.ok) {
          setError(result.error);
          setRecordingState(RecordingState.Error);
          return err(result.error);
        }

        const { transcript, detectedLang: detected } = result.value;

        setDetectedLang(detected);
        appendTranscript(transcript);
        setRecordingState(RecordingState.Done);

        // Language mismatch detection
        if (detected !== 'und' && detected !== lang && detected.length > 0) {
          setMismatch({ detected, suggested: lang });
        }

        // Save to history via HistoryService
        if (sessionId !== null) {
          if (!userSession) {
            logger.warn(
              '[Transcription] No user session, skipping history save',
            );
          } else {
            HistoryService.recordTranslation(
              {
                sourceLang: lang,
                targetLang: selectedLanguages[0] ?? 'en',
                transcript,
                translation: null,
                transliteration: null,
                duration: audio.durationMs,
                sourceApp: 'ekwe',
                provider: 'gemini', // Default or from context
              },
              userSession,
            ).catch((e) => logger.error('Failed to record history', e));
          }
        }

        return ok(result.value);
      } catch (error: unknown) {
        setIsTranscribing(false);
        const errType = error instanceof Error ? error.name : '';
        if (errType === 'AbortError') {
          // Silent failure for aborted requests
          return err(EkweError.NETWORK_LOST);
        }
        setError(EkweError.TRANSCRIPTION_FAIL);
        return err(EkweError.TRANSCRIPTION_FAIL);
      }
    },
    [
      sourceLang,
      selectedLanguages,
      sessionId,
      userSession,
      cancelTranscription,
      setError,
      setRecordingState,
      appendTranscript,
    ],
  );

  return {
    transcribe,
    cancelTranscription,
    isTranscribing,
    detectedLang,
    mismatch,
  };
};
