import { useCallback, useState } from 'react';

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

  const sourceLang = useAudioStore((s) => s.sourceLang);
  const setError = useAudioStore((s) => s.setError);
  const appendTranscript = useAudioStore((s) => s.appendTranscript);
  const setRecordingState = useAudioStore((s) => s.setRecordingState);
  const sessionId = useAudioStore((s) => s.sessionId);
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const addEntry = useHistoryStore((s) => s.addEntry);

  const transcribe = useCallback(
    async (
      audio: ProcessedAudio,
    ): Promise<Result<TranscriptionResult, EkweError>> => {
      setIsTranscribing(true);
      setMismatch(null);

      const lang = sourceLang ?? selectedLanguages[0] ?? 'en';

      const result = await TranscriptionService.transcribe(audio, lang);

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
    },
    [
      sourceLang,
      selectedLanguages,
      setError,
      appendTranscript,
      setRecordingState,
      sessionId,
      addEntry,
    ],
  );

  return { transcribe, isTranscribing, detectedLang, mismatch };
};
