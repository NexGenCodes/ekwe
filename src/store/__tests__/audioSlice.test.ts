import {
  createAudioSlice,
  RecordingState,
  AudioState,
  AudioActions,
} from '../audioSlice';

import { EkweError } from '@/constants/errors';

describe('Audio Slice', () => {
  let slice: AudioState & AudioActions;
  const set = jest.fn((fn) => {
    const newState = fn(slice);
    slice = { ...slice, ...newState };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    slice = createAudioSlice(set);
  });

  it('should initialize with correct default values', () => {
    expect(slice.recordingState).toBe(RecordingState.Idle);
    expect(slice.transcriptBuffer).toBe('');
    expect(slice.errorCode).toBeNull();
  });

  it('should update recording state', () => {
    slice.setRecordingState(RecordingState.Recording);
    expect(slice.recordingState).toBe(RecordingState.Recording);
  });

  it('should append text to transcript buffer', () => {
    slice.appendTranscript('Hello');
    slice.appendTranscript(' World');
    expect(slice.transcriptBuffer).toBe('Hello World');
  });

  it('should set an error and update state', () => {
    slice.setError(EkweError.NO_SPEECH);
    expect(slice.errorCode).toBe(EkweError.NO_SPEECH);
    expect(slice.recordingState).toBe(RecordingState.Error);
  });

  it('should set audio path, session ID, source and target languages, and duration', () => {
    slice.setAudioPath('test.wav');
    slice.setSessionId('123');
    slice.setSourceLang('en');
    slice.setTargetLang('es');
    slice.setDuration(10);
    expect(slice.audioPath).toBe('test.wav');
    expect(slice.sessionId).toBe('123');
    expect(slice.sourceLang).toBe('en');
    expect(slice.targetLang).toBe('es');
    expect(slice.duration).toBe(10);
  });

  it('should reset audio state to initial values', () => {
    slice.setRecordingState(RecordingState.Done);
    slice.appendTranscript('test');
    slice.resetAudioState();
    expect(slice.recordingState).toBe(RecordingState.Idle);
    expect(slice.transcriptBuffer).toBe('');
  });
});
