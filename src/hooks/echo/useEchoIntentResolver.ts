import { useSelector } from '@legendapp/state/react';
import { useShareIntent } from 'expo-share-intent';
import {
  useState,
  useEffect,
  useRef,
  MutableRefObject,
  Dispatch,
  SetStateAction,
  useMemo,
} from 'react';
import { isIOS, isAndroid } from '@/utils';

import { AudioCapture } from '@/services/AudioCapture';
import { IntentService } from '@/services/IntentService';
import { settings$, auth$ } from '@/store';
import { AppAlert, logger } from '@/utils';
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
    disabled: isAndroid,
  });

  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );
  const isInitialized = useSelector(() => auth$.isInitialized.get());
  const session = useSelector(() => auth$.session.get());

  const hasIOSFiles = isIOS && props.value && props.value.length > 0;

  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);

  // Track if this is a subsequent intent (to know when to reset flow state)
  const [isSubsequentIntent, setIsSubsequentIntent] = useState(false);

  const rawUri = useMemo(
    () => (hasIOSFiles ? props.value?.[0]?.value : props.audioUri),
    [hasIOSFiles, props.value, props.audioUri],
  );

  useEffect(() => {
    let isStale = false;

    IntentService.dismissNativeLoader();

    logger.info(
      '[IntentResolver] Guard check — rawUri:',
      rawUri ? rawUri.substring(0, 60) : 'MISSING',
      'isInitialized:',
      isInitialized,
      'onboardingCompleted:',
      onboardingCompleted,
      'session:',
      !!session,
    );

    if (!rawUri) {
      logger.warn('[IntentResolver] ❌ BLOCKED: no rawUri');
      return;
    }

    // Check if we are already handling this URI or have finished it
    if (rawUri === previousRawUri.current && activeResolvedUri.current) {
      logger.debug('[IntentResolver] Already resolved this URI — skipping');
      return;
    }

    if (rawUri === previousRawUri.current) {
      return; // Silently skip while processing
    }

    const isSubseq = previousRawUri.current !== undefined;
    previousRawUri.current = rawUri;

    if (activeResolvedUri.current) {
      cleanEchoCache(activeResolvedUri.current);
    }

    const resolve = async (): Promise<void> => {
      try {
        setIsResolving(true);
        logger.info(
          '[IntentResolver] resolve() started. rawUri:',
          rawUri.substring(0, 60),
        );

        const fileUri = await IntentService.resolveToFileUri(rawUri);

        if (isStale) {
          logger.info(
            '[IntentResolver] Stale after resolveToFileUri — aborting',
          );
          return;
        }

        if (!fileUri) {
          logger.warn('[IntentResolver] resolveToFileUri returned null');
          setIsResolving(false);
          AppAlert.error('Error', 'Could not access the shared audio file.');
          return;
        }

        logger.info('[IntentResolver] fileUri resolved:', fileUri);

        // Validation: verify the file is actually an audio file we can handle
        try {
          const mimeType = hasIOSFiles
            ? props.value?.[0]?.mimeType
            : props.mimeType;
          await AudioCapture.processSharedFile(fileUri, mimeType || 'audio/*');
        } catch {
          // Validation threw — keep the URI as best-effort fallback
        }

        // Set audio URI immediately so useSharedAudioPlayer starts decoding
        activeResolvedUri.current = fileUri;
        setAudioUri(fileUri);
        setIsResolving(false);
        setIsSubsequentIntent(isSubseq);
        logger.info('[IntentResolver] ✅ audioUri set + isResolving=false');
      } catch (err) {
        logger.error('[IntentResolver] ❌ Resolution FAILED:', err);
        setIsResolving(false);
      }
    };

    resolve();

    return (): void => {
      isStale = true;
    };
  }, [rawUri, props.mimeType, hasIOSFiles]);

  return {
    audioUri,
    isResolving,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
    resetShareIntent,
  };
};
