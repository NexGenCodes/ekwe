import { useShareIntent } from 'expo-share-intent';
import {
  useState,
  useEffect,
  useRef,
  MutableRefObject,
  Dispatch,
  SetStateAction,
} from 'react';
import { Alert, Platform } from 'react-native';

import { IntentService } from '@/services/IntentService';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { cleanEchoCache } from '@/utils/echo';

export const useEchoIntentResolver = (props: {
  value?: { value: string; mimeType: string }[];
  audioUri?: string;
  mimeType?: string;
}): {
  audioUri: string | undefined;
  isResolving: boolean;
  activeResolvedUri: MutableRefObject<string | undefined>;
  isSubsequentIntent: boolean;
  setIsSubsequentIntent: Dispatch<SetStateAction<boolean>>;
  resetShareIntent: (clearIntent?: boolean) => void;
} => {
  const { resetShareIntent } = useShareIntent({
    disabled: Platform.OS === 'android',
  });

  const { onboardingCompleted } = useSettingsStore();
  const { isInitialized, session } = useAuthStore();

  const isIOS = Platform.OS === 'ios';
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;

  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);

  // Track if this is a subsequent intent (to know when to reset flow state)
  const [isSubsequentIntent, setIsSubsequentIntent] = useState(false);

  useEffect(() => {
    let isStale = false;

    IntentService.dismissNativeLoader();

    const rawUri = hasIOSFiles ? props.value?.[0]?.value : props.audioUri;
    if (!rawUri) return;

    if (!isInitialized) return;

    if (!onboardingCompleted || !session) {
      IntentService.dismissAndRedirect(resetShareIntent);
      return;
    }

    if (rawUri === previousRawUri.current) return;

    const isSubseq = previousRawUri.current !== undefined;
    previousRawUri.current = rawUri;

    if (activeResolvedUri.current) {
      cleanEchoCache(activeResolvedUri.current);
    }

    const resolve = async (): Promise<void> => {
      setIsResolving(true);

      const fileUri = await IntentService.resolveToFileUri(rawUri);

      if (isStale) return;

      if (!fileUri) {
        setIsResolving(false);
        Alert.alert('Error', 'Could not access the shared audio file.');
        return;
      }

      activeResolvedUri.current = fileUri;
      setAudioUri(fileUri);
      setIsResolving(false);

      if (isSubseq) {
        setIsSubsequentIntent(true);
      }
    };

    resolve();

    return (): void => {
      isStale = true;
    };
  }, [
    props.audioUri,
    hasIOSFiles,
    props.value,
    resetShareIntent,
    isInitialized,
    session,
    onboardingCompleted,
  ]);

  return {
    audioUri,
    isResolving,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
    resetShareIntent,
  };
};
