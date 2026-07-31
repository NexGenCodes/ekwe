import { useSelector } from "@legendapp/state/react";
import { Paths } from "expo-file-system";
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
  const convertedUriRef = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);

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

    if (rawUri === previousRawUri.current && activeResolvedUri.current) {
      logger.debug("[IntentResolver] Already resolved this URI — skipping");
      return;
    }

    if (rawUri === previousRawUri.current) {
      return;
    }

    const isSubseq = previousRawUri.current !== undefined;
    previousRawUri.current = rawUri;

    if (activeResolvedUri.current) {
      cleanEchoCache(activeResolvedUri.current);
    }
    if (convertedUriRef.current) {
      cleanEchoCache(convertedUriRef.current);
      convertedUriRef.current = undefined;
    }

    const resolve = async (): Promise<void> => {
      try {
        setIsResolving(true);
        setConvertedWaveform([]);
        logger.info(
          "[IntentResolver] resolve() started. rawUri:",
          rawUri.substring(0, 60),
        );

        const cacheDir = Paths.cache.uri;

        // Attempt combined resolve + Ogg Opus conversion (Android only, no temp file)
        const opusPath = `${cacheDir}ekwe_converted_${Date.now()}.ogg`;
        const combinedResult = await IntentService.resolveAndConvertToOpus(
          rawUri,
          opusPath,
        );

        if (isStale) return;

        if (combinedResult && combinedResult.success) {
          convertedUriRef.current = opusPath;
          activeResolvedUri.current = opusPath;
          setAudioUri(opusPath);
          setConvertedWaveform(combinedResult.waveform);
          setIsResolving(false);
          setIsSubsequentIntent(isSubseq);
          logger.info("[IntentResolver] ✅ Combined resolve+convert succeeded");
          return;
        }

        // Fallback: separate resolve → validate → convert
        logger.info(
          "[IntentResolver] Combined path not available, using fallback",
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

        const mimeType = hasIOSFiles
          ? props.value?.[0]?.mimeType
          : props.mimeType;
        const result = await AudioCapture.processSharedFile(
          fileUri,
          mimeType || "audio/*",
        );
        const validatedUri = result.ok ? result.value.uri : fileUri;
        activeResolvedUri.current = validatedUri;

        // Convert to Opus + extract waveform via native C++
        const convertResult = await AudioConverter.convertToOpus(validatedUri);

        if (isStale) return;

        if (convertResult.ok) {
          const { uri: opusUri, waveform } = convertResult.value;
          convertedUriRef.current = opusUri;
          setAudioUri(opusUri);
          setConvertedWaveform(waveform);
          logger.info(
            "[IntentResolver] ✅ Converted to Opus + waveform extracted",
          );
        } else {
          logger.warn(
            "[IntentResolver] Opus conversion failed, using original",
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
  }, [
    rawUri,
    props.mimeType,
    hasIOSFiles,
    isInitialized,
    onboardingCompleted,
    props.value,
    session,
  ]);

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
