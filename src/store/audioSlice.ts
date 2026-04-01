import { EkweError } from 'src/constants/errors';
import type { StateCreator } from 'zustand';

export enum RecordingState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PROCESSING = 'processing',
  DONE = 'done',
  ERROR = 'error',
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

export type AudioSlice = AudioState & AudioActions;

const initialAudioState: AudioState = {
  recordingState: RecordingState.IDLE,
  transcriptBuffer: '',
  errorCode: null,
  sessionId: null,
  audioPath: null,
  sourceLang: null,
  targetLang: null,
  duration: null,
};

export const createAudioSlice: StateCreator<AudioSlice, [], [], AudioSlice> = (
  set,
) => ({
  ...initialAudioState,
  setRecordingState: (state: RecordingState): void => {
    set({ recordingState: state });
  },
  appendTranscript: (text: string): void => {
    set((prev) => ({ transcriptBuffer: prev.transcriptBuffer + text }));
  },
  setError: (code: EkweError): void => {
    set({ errorCode: code, recordingState: RecordingState.ERROR });
  },
  setAudioPath: (path: string): void => {
    set({ audioPath: path });
  },
  setSessionId: (id: string): void => {
    set({ sessionId: id });
  },
  setSourceLang: (code: string): void => {
    set({ sourceLang: code });
  },
  setTargetLang: (code: string): void => {
    set({ targetLang: code });
  },
  setDuration: (seconds: number): void => {
    set({ duration: seconds });
  },
  resetAudioState: (): void => {
    set(initialAudioState);
  },
});
