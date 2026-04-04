import { renderHook, act } from '@testing-library/react-native';
import { EkweError } from 'src/constants/errors';
import { useDeepLink } from 'src/hooks/useDeepLink';
import { AudioCapture } from 'src/services/AudioCapture';
import { AudioProcessor } from 'src/services/AudioProcessor';
import { DeepLinkHandler, DeepLinkPayload } from 'src/services/DeepLinkHandler';
import { useAudioStore } from 'src/store';
import { ok, err } from 'src/types/Result';

jest.mock('src/services/DeepLinkHandler', () => ({
  DeepLinkHandler: {
    initialise: jest.fn().mockReturnValue(jest.fn()),
    subscribe: jest.fn(),
    consumePendingPayload: jest.fn().mockReturnValue(null),
  },
}));

jest.mock('src/services/AudioCapture');
jest.mock('src/services/AudioProcessor');

describe('useDeepLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAudioStore.getState().resetAudioState();
    (DeepLinkHandler.consumePendingPayload as jest.Mock).mockReturnValue(null);
  });

  it('initialises without calling hook if no pending payload', () => {
    const onPayload = jest.fn();
    const { result } = renderHook(() => useDeepLink(onPayload));

    act(() => {
      result.current.initialise();
    });

    expect(DeepLinkHandler.initialise).toHaveBeenCalled();
    expect(DeepLinkHandler.subscribe).toHaveBeenCalled();
    expect(onPayload).not.toHaveBeenCalled();
  });

  it('consumes pending payload on mount', () => {
    (DeepLinkHandler.consumePendingPayload as jest.Mock).mockReturnValue({
      type: 'share',
      uri: 'test.mp3',
    });

    const onPayload = jest.fn();
    const { result } = renderHook(() => useDeepLink(onPayload));

    act(() => {
      result.current.initialise();
    });

    expect(onPayload).toHaveBeenCalledWith({ type: 'share', uri: 'test.mp3' });
  });

  it('handles deep link event success flow', async () => {
    let subscriber: (payload: DeepLinkPayload) => Promise<void>;
    (DeepLinkHandler.subscribe as jest.Mock).mockImplementation((cb) => {
      subscriber = cb;
      return jest.fn();
    });

    (AudioCapture.processSharedFile as jest.Mock).mockResolvedValue(
      ok({ uri: 'verified.mp3', durationMs: 0 }),
    );
    (AudioProcessor.validateSharedFile as jest.Mock).mockResolvedValue(
      ok({ uri: 'validated.mp3', durationMs: 0 }),
    );

    const onPayload = jest.fn();
    const { result } = renderHook(() => useDeepLink(onPayload));

    act(() => {
      result.current.initialise();
    });

    // Fire the mock event
    await act(async () => {
      await subscriber({ type: 'share', uri: 'deep.mp3', sourceApp: null });
    });

    const state = useAudioStore.getState();
    expect(state.audioPath).toBe('validated.mp3');
    expect(onPayload).toHaveBeenCalled();
  });

  it('handles DeepLink error flow', async () => {
    let subscriber: (payload: DeepLinkPayload) => Promise<void>;
    (DeepLinkHandler.subscribe as jest.Mock).mockImplementation((cb) => {
      subscriber = cb;
      return jest.fn();
    });

    (AudioCapture.processSharedFile as jest.Mock).mockResolvedValue(
      err(EkweError.BAD_FORMAT),
    );

    const onPayload = jest.fn();
    const { result } = renderHook(() => useDeepLink(onPayload));

    act(() => {
      result.current.initialise();
    });

    await act(async () => {
      await subscriber({ type: 'share', uri: 'deep.txt', sourceApp: null });
    });

    const state = useAudioStore.getState();
    expect(state.errorCode).toBe(EkweError.BAD_FORMAT);
    expect(onPayload).not.toHaveBeenCalled();
  });
});
