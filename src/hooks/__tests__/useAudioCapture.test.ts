import { renderHook, act } from '@testing-library/react-native';
import { EkweError } from 'src/constants/errors';
import { useAudioCapture } from 'src/hooks/useAudioCapture';
import { AudioCapture } from 'src/services/AudioCapture';
import { AudioProcessor } from 'src/services/AudioProcessor';
import { useAudioStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';
import { ok, err } from 'src/types/Result';

jest.mock('src/services/AudioCapture');
jest.mock('src/services/AudioProcessor');
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('mock-uuid-123') }));

describe('useAudioCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAudioStore.getState().resetAudioState();
  });

  it('initialises with correct default state', () => {
    const { result } = renderHook(() => useAudioCapture());
    expect(result.current.isRecording).toBe(false);
  });

  it('startRecording handles successful start', async () => {
    (AudioCapture.startRecording as jest.Mock).mockResolvedValue(ok(undefined));

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      const res = await result.current.startRecording();
      expect(res.ok).toBe(true);
    });

    const state = useAudioStore.getState();
    expect(state.recordingState).toBe(RecordingState.Recording);
    expect(state.sessionId).toBe('mock-uuid-123');
  });

  it('startRecording handles error', async () => {
    (AudioCapture.startRecording as jest.Mock).mockResolvedValue(
      err(EkweError.PERMISSION_MIC),
    );

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      const res = await result.current.startRecording();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(EkweError.PERMISSION_MIC);
    });

    const state = useAudioStore.getState();
    expect(state.errorCode).toBe(EkweError.PERMISSION_MIC);
  });

  it('stopRecording handles success through both services', async () => {
    (AudioCapture.stopRecording as jest.Mock).mockResolvedValue(
      ok({
        uri: 'raw.m4a',
        durationMs: 1000,
        meteringData: [0],
        sessionId: '123',
      }),
    );
    (AudioProcessor.processRecording as jest.Mock).mockResolvedValue(
      ok({
        uri: 'processed.m4a',
        durationMs: 1000,
      }),
    );

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      const res = await result.current.stopRecording();
      expect(res.ok).toBe(true);
    });

    const state = useAudioStore.getState();
    expect(state.recordingState).toBe(RecordingState.Done);
    expect(state.audioPath).toBe('processed.m4a');
    expect(state.duration).toBe(1); // 1000ms rounded to seconds
  });

  it('stopRecording propagates AudioCapture error', async () => {
    (AudioCapture.stopRecording as jest.Mock).mockResolvedValue(
      err(EkweError.TOO_SHORT),
    );

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      const res = await result.current.stopRecording();
      expect(res.ok).toBe(false);
    });

    const state = useAudioStore.getState();
    expect(state.errorCode).toBe(EkweError.TOO_SHORT);
  });

  it('stopRecording propagates AudioProcessor error', async () => {
    (AudioCapture.stopRecording as jest.Mock).mockResolvedValue(
      ok({
        uri: 'raw.m4a',
        durationMs: 1000,
        meteringData: [0],
        sessionId: '123',
      }),
    );
    (AudioProcessor.processRecording as jest.Mock).mockResolvedValue(
      err(EkweError.AUDIO_EMPTY),
    );

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      const res = await result.current.stopRecording();
      expect(res.ok).toBe(false);
    });

    const state = useAudioStore.getState();
    expect(state.errorCode).toBe(EkweError.AUDIO_EMPTY);
  });

  it('cancelRecording triggers AudioCapture.cancel and resets store', async () => {
    useAudioStore.getState().setRecordingState(RecordingState.Recording);

    const { result } = renderHook(() => useAudioCapture());

    await act(async () => {
      await result.current.cancelRecording();
    });

    expect(AudioCapture.cancelRecording).toHaveBeenCalled();
    const state = useAudioStore.getState();
    expect(state.recordingState).toBe(RecordingState.Idle);
  });
});
