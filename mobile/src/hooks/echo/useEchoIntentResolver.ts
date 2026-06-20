import { useSelector } from "@legendapp/state/react";
import {
  useState,
  useEffect,
  useRef,
  MutableRefObject,
  Dispatch,
  SetStateAction,
  useMemo,
} from "react";

import { AudioCapture } from "@/services/AudioCapture";
import { AudioConverter } from "@/services/AudioConverter";
import { IntentService } from "@/services/IntentService";
import { settings$, auth$ } from "@/store";
import { isIOS, AppAlert, logger } from "@/utils";
import { cleanEchoCache } from "@/utils/echo";

const noopResetShareIntent = (): void => {};

export const useEchoIntentResolver = (props: {
  value?: { value: string; mimeType: string }[];
  audioUri?: string;
  mimeType?: string;
}): {
  audioUri: string | undefined;
  isResolving: boolean;
  convertedWaveform: number[];
  activeResolvedUri: MutableRefObject<string | undefined>;
  isSubsequentIntent: boolean;
  setIsSubsequentIntent: Dispatch<SetStateAction<boolean>>;
  resetShareIntent: (clearIntent?: boolean) => void;
} => {
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );
  const isInitialized = useSelector(() => auth$.isInitialized.get());
  const session = useSelector(() => auth$.session.get());

  const hasIOSFiles = isIOS && props.value && props.value.length > 0;

  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [convertedWaveform, setConvertedWaveform] = useState<number[]>([]);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const convertedFlacUriRef = useRef<string | undefined>(undefined);
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
      "[IntentResolver] Guard check — rawUri:",
      rawUri ? rawUri.substring(0, 60) : "MISSING",
      "isInitialized:",
      isInitialized,
      "onboardingCompleted:",
      onboardingCompleted,
      "session:",
      !!session,
    );

    if (!rawUri) {
      logger.warn("[IntentResolver] ❌ BLOCKED: no rawUri");
      return;
    }

    // Check if we are already handling this URI or have finished it
    if (rawUri === previousRawUri.current && activeResolvedUri.current) {
      logger.debug("[IntentResolver] Already resolved this URI — skipping");
      return;
    }

    if (rawUri === previousRawUri.current) {
      return; // Silently skip while processing
    }

    const isSubseq = previousRawUri.current !== undefined;
    previousRawUri.current = rawUri;

    // Clean up previous session files
    if (activeResolvedUri.current) {
      cleanEchoCache(activeResolvedUri.current);
    }
    if (convertedFlacUriRef.current) {
      cleanEchoCache(convertedFlacUriRef.current);
      convertedFlacUriRef.current = undefined;
    }

    const resolve = async (): Promise<void> => {
      try {
        setIsResolving(true);
        setConvertedWaveform([]);
        logger.info(
          "[IntentResolver] resolve() started. rawUri:",
          rawUri.substring(0, 60),
        );

        const fileUri = await IntentService.resolveToFileUri(rawUri);

        if (isStale) {
          logger.info(
            "[IntentResolver] Stale after resolveToFileUri — aborting",
          );
          return;
        }

        if (!fileUri) {
          logger.warn("[IntentResolver] resolveToFileUri returned null");
          setIsResolving(false);
          AppAlert.error("Error", "Could not access the shared audio file.");
          return;
        }

        logger.info("[IntentResolver] fileUri resolved:", fileUri);

        // Validate shared audio file format
        const mimeType = hasIOSFiles
          ? props.value?.[0]?.mimeType
          : props.mimeType;
        const result = await AudioCapture.processSharedFile(
          fileUri,
          mimeType || "audio/*",
        );
        const validatedUri = result.ok ? result.value.uri : fileUri;
        activeResolvedUri.current = validatedUri;

        // Convert to FLAC + extract waveform via native C++ on both platforms
        // (shared audio can be any format — convert to canonical FLAC for upload)
        const convertResult = await AudioConverter.convertToFlac(validatedUri);

        if (isStale) return;

        if (convertResult.ok) {
          const { uri: flacUri, waveform } = convertResult.value;
          convertedFlacUriRef.current = flacUri;
          setAudioUri(flacUri);
          setConvertedWaveform(waveform);
          logger.info(
            "[IntentResolver] ✅ Converted to FLAC + waveform extracted",
          );
        } else {
          // Fall back to validated URI if conversion fails
          logger.warn(
            "[IntentResolver] FLAC conversion failed, using original",
          );
          setAudioUri(validatedUri);
        }

        setIsResolving(false);
        setIsSubsequentIntent(isSubseq);
        logger.info("[IntentResolver] ✅ audioUri set + isResolving=false");
      } catch (err) {
        logger.error("[IntentResolver] ❌ Resolution FAILED:", err);
        setIsResolving(false);
      }
    };

    resolve();

    return (): void => {
      isStale = true;
    };
  }, [rawUri, props.mimeType, hasIOSFiles, isInitialized, onboardingCompleted, props.value, session]);

  return {
    audioUri,
    isResolving,
    convertedWaveform,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
    resetShareIntent: noopResetShareIntent,
  };
};
