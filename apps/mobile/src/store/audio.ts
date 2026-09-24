import { observable } from "@legendapp/state";

import { EkweError } from "@/constants/errors";

export enum RecordingState {
  Idle = "idle",
  Recording = "recording",
  Processing = "processing",
  Done = "done",
  Error = "error",
}

export interface AudioState {
  recordingState: RecordingState;
  transcriptBuffer: string;
  isSaved: boolean;
  errorCode: EkweError | null;
  sessionId: string | null;
  audioPath: string | null;
  sourceLang: string | null;
  targetLang: string | null;
  duration: number | null;
}

const initialAudioState: AudioState = {
  recordingState: RecordingState.Idle,
  transcriptBuffer: "",
  isSaved: false,
  errorCode: null,
  sessionId: null,
  audioPath: null,
  sourceLang: null,
  targetLang: null,
  duration: null,
};

export const audio$ = observable<AudioState>(initialAudioState);

export const audioActions = {
  setSaved: (saved: boolean): void => {
    audio$.isSaved.set(saved);
  },
  setRecordingState: (state: RecordingState): void => {
    audio$.recordingState.set(state);
  },
  appendTranscript: (text: string): void => {
    audio$.transcriptBuffer.set((prev) => prev + text);
  },
  setError: (code: EkweError): void => {
    audio$.errorCode.set(code);
    audio$.recordingState.set(RecordingState.Error);
  },
  setAudioPath: (path: string): void => {
    audio$.audioPath.set(path);
  },
  setSessionId: (id: string): void => {
    audio$.sessionId.set(id);
  },
  setSourceLang: (code: string): void => {
    audio$.sourceLang.set(code);
  },
  setTargetLang: (code: string): void => {
    audio$.targetLang.set(code);
  },
  setDuration: (seconds: number): void => {
    audio$.duration.set(seconds);
  },
  resetAudioState: (): void => {
    audio$.set(initialAudioState);
  },
};
