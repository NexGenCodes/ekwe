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
import { AudioTranscoder } from "@/services/AudioTranscoder";
import { IntentService } from "@/services/IntentService";
import { settings$, auth$ } from "@/store";
import { SharedFile } from "@/types/echo";
import { AppAlert } from "@/utils/alert";
import { isIOS } from "@/utils/platform";
import { default as logger } from "@/utils/logger";
import { cleanEchoCache } from "@/utils/echo";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { createDeferredCacheCleaner } from "./deferredCacheCleaner";

export const useEchoAudioResolver = (props: {
  value?: SharedFile[];
  audioUri?: string;
  mimeType?: string;
}): {
  audioUri: string | undefined;
  isResolving: boolean;
  convertedWaveform: number[];
  convertedDurationMs: number | null;
  activeResolvedUri: MutableRefObject<string | undefined>;
  isSubsequentIntent: boolean;
  setIsSubsequentIntent: Dispatch<SetStateAction<boolean>>;
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
  const [convertedDurationMs, setConvertedDurationMs] = useState<
    number | null
  >(null);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const convertedUriRef = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);

  // Deletes the previously-resolved files ONLY after a new source has been
  // committed, so the player never points at a removed file (it swaps sources
  // in-place via player.replace()). See deferredCacheCleaner for the contract.
  const deferredCleanupRef = useRef(createDeferredCacheCleaner(cleanEchoCache));

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

    if (!isInitialized || !session) {
      logger.info(
        "[IntentResolver] ⏳ Waiting for auth init before resolving...",
      );
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

    // Capture the previous files but do NOT delete them yet: the player still
    // references the old source and only swaps to the new one once resolution
    // completes. Deleting now would leave the player pointing at a gone file.
    // Tear-down is deferred until the new source is committed.
    deferredCleanupRef.current.remember(
      activeResolvedUri.current,
      convertedUriRef.current,
    );

    const resolve = async (): Promise<void> => {
      try {
        setIsResolving(true);
        setConvertedWaveform([]);
        setConvertedDurationMs(null);
        logger.info(
          "[IntentResolver] resolve() started. rawUri:",
          rawUri.substring(0, 60),
        );

        const cacheDir = Paths.cache.uri;

        // Attempt combined resolve + Ogg Opus conversion (Android only, no temp file)
        const opusPath = `${cacheDir}ekwe_converted_${Date.now()}.ogg`;
        const combinedResult = await IntentService.resolveAndTranscodeToOpus(
          rawUri,
          opusPath,
        );

        if (isStale) return;

        if (combinedResult && combinedResult.success) {
          deferredCleanupRef.current.cleanup();
          convertedUriRef.current = opusPath;
          activeResolvedUri.current = opusPath;
          setAudioUri(opusPath);
          setConvertedWaveform(combinedResult.waveform);
          setConvertedDurationMs(combinedResult.durationMs);
          setIsResolving(false);
          setIsSubsequentIntent(isSubseq);
          logger.info("[IntentResolver] ✅ Combined resolve+convert succeeded");
          return;
        }

        // A file over the hard size cap was rejected natively — stop before the
        // fallback (which validates but can't shrink it) and tell the user.
        if (combinedResult && combinedResult.error === "FILE_TOO_LARGE") {
          setIsResolving(false);
          logger.warn("[IntentResolver] ❌ FILE_TOO_LARGE rejected by native");
          AppAlert.error(ErrorMessages[EkweError.FILE_TOO_LARGE]);
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
        const convertResult = await AudioTranscoder.transcodeToOpus(validatedUri);

        if (isStale) return;

        deferredCleanupRef.current.cleanup();
        if (convertResult.ok) {
          const { uri: opusUri, waveform, durationMs } = convertResult.value;
          convertedUriRef.current = opusUri;
          setAudioUri(opusUri);
          setConvertedWaveform(waveform);
          setConvertedDurationMs(durationMs);
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
    convertedDurationMs,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
  };
};
