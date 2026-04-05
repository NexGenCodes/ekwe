import { renderHook, act } from '@testing-library/react-native';
import { EkweError } from 'src/constants/errors';
import { useTranscription } from 'src/hooks/useTranscription';
import { TranscriptionService } from 'src/services/Transcription';
import { useAudioStore, useSettingsStore, useHistoryStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';
import { ok, err } from 'src/types/Result';

jest.mock('src/services/Transcription');

const mockAudio = {
  uri: 'file://mock.m4a',
  durationMs: 5000,
  trimStartMs: 0,
  trimEndMs: 5000,
  hasSpeech: true,
  averageDb: 0.5,
  meteringData: [],
};

describe('useTranscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAudioStore.setState({
      sourceLang: 'en',
      sessionId: 'test-session',
      appendTranscript: jest.fn(),
      setError: jest.fn(),
      setRecordingState: jest.fn(),
    });
    useSettingsStore.setState({
      selectedLanguages: ['es'],
    });
    useHistoryStore.setState({
      addEntry: jest.fn(),
    });
  });

  it('transcribe sets isTranscribing during call', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let resolvePromise: (value: any) => void = () => {};
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    (TranscriptionService.transcribe as jest.Mock).mockReturnValue(promise);

    const { result } = renderHook(() => useTranscription());

    let transcribeResult: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    act(() => {
      transcribeResult = result.current.transcribe(mockAudio);
    });

    expect(result.current.isTranscribing).toBe(true);

    await act(async () => {
      resolvePromise(
        ok({
          transcript: 'Hello',
          detectedLang: 'en',
          sourceLang: 'en',
          wordTimestamps: [],
          durationSeconds: 5,
          isLowQuality: false,
          fillerWordsRemoved: 0,
        }),
      );
      await transcribeResult;
    });

    expect(result.current.isTranscribing).toBe(false);
  });

  it('transcribe on success calls store actions', async () => {
    const appendTranscript = jest.fn();
    const setRecordingState = jest.fn();
    const addEntry = jest.fn();
    useAudioStore.setState({ appendTranscript, setRecordingState });
    useHistoryStore.setState({ addEntry });
    (TranscriptionService.transcribe as jest.Mock).mockResolvedValue(
      ok({
        transcript: 'Hello',
        detectedLang: 'en',
        sourceLang: 'en',
        wordTimestamps: [],
        durationSeconds: 5,
        isLowQuality: false,
        fillerWordsRemoved: 0,
      }),
    );

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      await result.current.transcribe(mockAudio);
    });

    expect(appendTranscript).toHaveBeenCalledWith('Hello');
    expect(setRecordingState).toHaveBeenCalledWith(RecordingState.Done);
    expect(addEntry).toHaveBeenCalled();
  });

  it('transcribe on error calls setError', async () => {
    const setError = jest.fn();
    const setRecordingState = jest.fn();
    useAudioStore.setState({ setError, setRecordingState });
    (TranscriptionService.transcribe as jest.Mock).mockResolvedValue(
      err(EkweError.TRANSCRIPTION_FAIL),
    );

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      await result.current.transcribe(mockAudio);
    });

    expect(setError).toHaveBeenCalledWith(EkweError.TRANSCRIPTION_FAIL);
    expect(setRecordingState).toHaveBeenCalledWith(RecordingState.Error);
  });

  it('mismatch is set when detected lang differs from requested', async () => {
    (TranscriptionService.transcribe as jest.Mock).mockResolvedValue(
      ok({
        transcript: 'Hola',
        detectedLang: 'es', // detected Spanish
        sourceLang: 'en', // but requested English
        wordTimestamps: [],
        durationSeconds: 5,
        isLowQuality: false,
        fillerWordsRemoved: 0,
      }),
    );

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      await result.current.transcribe(mockAudio);
    });

    expect(result.current.detectedLang).toBe('es');
    expect(result.current.mismatch).toEqual({
      detected: 'es',
      suggested: 'en',
    });
  });

  it('mismatch is null when detected matches or is und', async () => {
    // Case 1: Match
    (TranscriptionService.transcribe as jest.Mock).mockResolvedValue(
      ok({
        transcript: 'Hello',
        detectedLang: 'en',
        sourceLang: 'en',
        wordTimestamps: [],
        durationSeconds: 5,
        isLowQuality: false,
        fillerWordsRemoved: 0,
      }),
    );

    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      await result.current.transcribe(mockAudio);
    });
    expect(result.current.mismatch).toBeNull();

    // Case 2: Undetermined
    (TranscriptionService.transcribe as jest.Mock).mockResolvedValue(
      ok({
        transcript: '...',
        detectedLang: 'und',
        sourceLang: 'en',
        wordTimestamps: [],
        durationSeconds: 5,
        isLowQuality: false,
        fillerWordsRemoved: 0,
      }),
    );

    await act(async () => {
      await result.current.transcribe(mockAudio);
    });
    expect(result.current.mismatch).toBeNull();
  });
});
