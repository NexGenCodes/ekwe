import { EkweError } from 'src/constants/errors';

export enum RecordingState {
  Idle = 'idle',
  Recording = 'recording',
  Processing = 'processing',
  Done = 'done',
  Error = 'error',
}

export interface AudioState {
  recordingState: RecordingState;
  transcriptBuffer: string;
  errorCode: EkweError | null;
  sessionId: string | null;
  audioPath: string | null;
  sourceLang: string | null;
  targetLang: string | null;
  duration: number | null;
}

export interface AudioActions {
  setRecordingState: (state: RecordingState) => void;
  appendTranscript: (text: string) => void;
  setError: (code: EkweError) => void;
  setAudioPath: (path: string) => void;
  setSessionId: (id: string) => void;
  setSourceLang: (code: string) => void;
  setTargetLang: (code: string) => void;
  setDuration: (seconds: number) => void;
  resetAudioState: () => void;
}

const initialAudioState: AudioState = {
  recordingState: RecordingState.Idle,
  transcriptBuffer: '',
  errorCode: null,
  sessionId: null,
  audioPath: null,
  sourceLang: null,
  targetLang: null,
  duration: null,
};

export const createAudioSlice = (
  set: (fn: (state: AudioState) => Partial<AudioState>) => void,
): AudioState & AudioActions => ({
  ...initialAudioState,
  setRecordingState: (recordingState): void => set(() => ({ recordingState })),
  appendTranscript: (text): void =>
    set((state) => ({ transcriptBuffer: state.transcriptBuffer + text })),
  setError: (errorCode): void =>
    set(() => ({ errorCode, recordingState: RecordingState.Error })),
  setAudioPath: (audioPath): void => set(() => ({ audioPath })),
  setSessionId: (sessionId): void => set(() => ({ sessionId })),
  setSourceLang: (sourceLang): void => set(() => ({ sourceLang })),
  setTargetLang: (targetLang): void => set(() => ({ targetLang })),
  setDuration: (duration): void => set(() => ({ duration })),
  resetAudioState: (): void => set(() => ({ ...initialAudioState })),
});
