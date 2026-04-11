import { EkweError } from '@/constants/errors';

export enum RecordingState {
  Idle = 'idle',
  Recording = 'recording',
  Processing = 'processing',
  Done = 'done',
  Error = 'error',
  Overlay = 'overlay', // New state for shared file processing
}

export enum OverlayStep {
  Pick = 'pick',
  Preview = 'preview',
  Process = 'process',
  Result = 'result',
}

export type FloatingHeadType = 'none' | 'bubble' | 'card';

export interface AudioState {
  recordingState: RecordingState;
  transcriptBuffer: string;
  errorCode: EkweError | null;
  sessionId: string | null;
  audioPath: string | null;
  sourceLang: string | null;
  targetLang: string | null;
  duration: number | null;
  // Unified Overlay State
  showOverlay: boolean;
  overlayStep: OverlayStep;
  overlayFileUri: string | null;
  overlayMimeType: string | null;
  activeFloatingHead: FloatingHeadType;
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
  setOverlayState: (
    visible: boolean,
    step?: OverlayStep,
    uri?: string,
    mime?: string,
  ) => void;
  setActiveFloatingHead: (head: FloatingHeadType) => void;
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
  showOverlay: false,
  overlayStep: OverlayStep.Pick,
  overlayFileUri: null,
  overlayMimeType: null,
  activeFloatingHead: 'none',
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
  setOverlayState: (
    showOverlay,
    overlayStep,
    overlayFileUri,
    overlayMimeType,
  ): void =>
    set((state) => ({
      showOverlay,
      overlayStep: overlayStep ?? state.overlayStep,
      overlayFileUri: overlayFileUri ?? state.overlayFileUri,
      overlayMimeType: overlayMimeType ?? state.overlayMimeType,
      activeFloatingHead: showOverlay
        ? 'card'
        : state.activeFloatingHead === 'card'
          ? 'none'
          : state.activeFloatingHead,
    })),
  setActiveFloatingHead: (activeFloatingHead): void =>
    set(() => ({ activeFloatingHead })),
  resetAudioState: (): void => set(() => ({ ...initialAudioState })),
});
