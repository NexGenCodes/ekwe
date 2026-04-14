import { useCallback, useEffect, useRef, useState } from 'react';

import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import {
  TranscriptionService,
  TranscriptionResult,
} from '@/services/Transcription';
import { useAudioStore, useSettingsStore, useHistoryStore } from '@/store';
import { RecordingState } from '@/store/audioSlice';
import { Result, ok, err } from '@/types/Result';

export interface UseTranscriptionReturn {
  transcribe: (
    audio: ProcessedAudio,
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

  const sourceLang = useAudioStore((s) => s.sourceLang);
  const setError = useAudioStore((s) => s.setError);
  const appendTranscript = useAudioStore((s) => s.appendTranscript);
  const setRecordingState = useAudioStore((s) => s.setRecordingState);
  const sessionId = useAudioStore((s) => s.sessionId);
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const addEntry = useHistoryStore((s) => s.addEntry);

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
    ): Promise<Result<TranscriptionResult, EkweError>> => {
      // Cancel previous if any
      cancelTranscription();

      setIsTranscribing(true);
      setMismatch(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const lang = sourceLang ?? selectedLanguages[0] ?? 'en';

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

        // Save to history
        if (sessionId !== null) {
          addEntry({
            id: sessionId,
            sourceLang: lang,
            targetLang: selectedLanguages[0] ?? 'en',
            transcript,
            translation: null,
            timestamp: Date.now(),
            duration: Math.round(audio.durationMs / 1000),
            sourceApp: null,
          });
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
      setError,
      appendTranscript,
      setRecordingState,
      sessionId,
      addEntry,
      cancelTranscription,
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
