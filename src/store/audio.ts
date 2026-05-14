import { observable } from '@legendapp/state';

import { EkweError } from '@/constants/errors';

export enum RecordingState {
  Idle = 'idle',
  Recording = 'recording',
  Processing = 'processing',
  Done = 'done',
  Error = 'error',
  Overlay = 'overlay',
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
  showOverlay: boolean;
  overlayStep: OverlayStep;
  overlayFileUri: string | null;
  overlayMimeType: string | null;
  overlaySourceApp: string | null;
  activeFloatingHead: FloatingHeadType;
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
  overlaySourceApp: null,
  activeFloatingHead: 'none',
};

export const audio$ = observable<AudioState>(initialAudioState);

// Actions
export const audioActions = {
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
  setOverlayState: (
    showOverlay: boolean,
    overlayStep?: OverlayStep,
    overlayFileUri?: string,
    overlayMimeType?: string,
    overlaySourceApp?: string,
  ): void => {
    audio$.assign({
      showOverlay,
      overlayStep: overlayStep ?? audio$.overlayStep.get(),
      overlayFileUri: overlayFileUri ?? audio$.overlayFileUri.get(),
      overlayMimeType: overlayMimeType ?? audio$.overlayMimeType.get(),
      overlaySourceApp: overlaySourceApp ?? audio$.overlaySourceApp.get(),
      activeFloatingHead: showOverlay
        ? 'card'
        : audio$.activeFloatingHead.get() === 'card'
          ? 'none'
          : audio$.activeFloatingHead.get(),
    });
  },
  setActiveFloatingHead: (head: FloatingHeadType): void => {
    audio$.activeFloatingHead.set(head);
  },
  resetAudioState: (): void => {
    audio$.set(initialAudioState);
  },
};
