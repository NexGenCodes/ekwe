import { AudioCapture } from 'src/services/AudioCapture';
import { AudioProcessor } from 'src/services/AudioProcessor';
import { DeepLinkHandler, DeepLinkPayload } from 'src/services/DeepLinkHandler';
import { useAudioStore } from 'src/store';
import { RecordingState } from 'src/store/audioSlice';

export type { DeepLinkPayload };

export interface UseDeepLinkReturn {
  initialise: () => () => void;
}

/**
 * Hook that wires DeepLinkHandler to the audio pipeline.
 * Handles incoming shared audio files via the ekwe://share deep link.
 */
export const useDeepLink = (
  onPayload: (payload: DeepLinkPayload) => void,
): UseDeepLinkReturn => {
  const setRecordingState = useAudioStore((s) => s.setRecordingState);
  const setError = useAudioStore((s) => s.setError);
  const setAudioPath = useAudioStore((s) => s.setAudioPath);

  /**
   * Initialises deep link handling and returns an unsubscribe function.
   * Processes incoming share payloads through AudioCapture + AudioProcessor.
   */
  const initialise = (): (() => void) => {
    const unsubscribeDeepLink = DeepLinkHandler.subscribe(async (payload) => {
      if (payload.type === 'share') {
        setRecordingState(RecordingState.Processing);

        const captureResult = await AudioCapture.processSharedFile(payload.uri);

        if (!captureResult.ok) {
          setError(captureResult.error);
          return;
        }

        const processResult = await AudioProcessor.validateSharedFile(
          captureResult.value.uri,
        );

        if (!processResult.ok) {
          setError(processResult.error);
          return;
        }

        setAudioPath(processResult.value.uri);
        onPayload(payload);
      }
    });

    const unsubscribeInitial = DeepLinkHandler.initialise();

    // Consume any payload that arrived before the hook mounted
    const pending = DeepLinkHandler.consumePendingPayload();
    if (pending !== null) {
      onPayload(pending);
    }

    return () => {
      unsubscribeDeepLink();
      unsubscribeInitial();
    };
  };

  return { initialise };
};
