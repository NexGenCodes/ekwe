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
import { SharedFile } from "@/types/echo";
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
  resolveError: string | null;
  resolveRetryable: boolean;
  retryResolve: () => void;
  activeResolvedUri: MutableRefObject<string | undefined>;
  isSubsequentIntent: boolean;
  setIsSubsequentIntent: Dispatch<SetStateAction<boolean>>;
} => {
  const hasIOSFiles = isIOS && props.value && props.value.length > 0;

  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [convertedWaveform, setConvertedWaveform] = useState<number[]>([]);
  const [convertedDurationMs, setConvertedDurationMs] = useState<number | null>(
    null,
  );
  const [resolveError, setResolveError] = useState<string | null>(null);
  // True while the current failure is a terminal file condition (e.g.
  // FILE_TOO_LARGE) that retrying can never fix. The Error step therefore must
  // not offer "Try Again" (it would only re-resolve the same oversized file).
  const [resolveRetryable, setResolveRetryable] = useState(true);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const convertedUriRef = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);

  // Deletes the previously-resolved files ONLY after a new source has been
  // committed, so the player never points at a removed file (it swaps sources
  // in-place via player.replace()). See deferredCacheCleaner for the contract.
  const deferredCleanupRef = useRef(createDeferredCacheCleaner(cleanEchoCache));

  const [isSubsequentIntent, setIsSubsequentIntent] = useState(false);

  // Bumping this nonce forces the resolution effect to re-run even when the
  // rawUri is unchanged (the retry path after a resolve failure).
  const [retryNonce, setRetryNonce] = useState(0);
  const retryResolve = (): void => {
    previousRawUri.current = undefined;
    setResolveError(null);
    setResolveRetryable(true);
    setRetryNonce((n) => n + 1);
  };

  const rawUri = useMemo(
    () => (hasIOSFiles ? props.value?.[0]?.value : props.audioUri),
    [hasIOSFiles, props.value, props.audioUri],
  );

  const mimeType = useMemo(
    () => (hasIOSFiles ? props.value?.[0]?.mimeType : props.mimeType),
    [hasIOSFiles, props.value, props.mimeType],
  );

  useEffect(() => {
    let isStale = false;

    IntentService.dismissNativeLoader();

    logger.debug(
      "[IntentResolver] Resolving rawUri:",
      rawUri ? rawUri.substring(0, 60) : "MISSING",
    );

    if (!rawUri) {
      logger.warn("[IntentResolver] ❌ BLOCKED: no rawUri");
      return;
    }

    if (rawUri === previousRawUri.current) {
      logger.debug("[IntentResolver] Already resolved this URI — skipping");
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
      // Files created this attempt; declared at function scope so the
      // stale-abort and catch paths can prune whatever was not committed.
      let fileUri: string | null = null;
      let validatedUri: string | null = null;
      let opusPathAttempted: string | null = null;
      try {
        setIsResolving(true);
        setResolveError(null);
        // Each attempt restarts as retryable (only specific terminal outcomes
        // like FILE_TOO_LARGE flip it back off).
        setResolveRetryable(true);
        setConvertedWaveform([]);
        setConvertedDurationMs(null);
        logger.info(
          "[IntentResolver] resolve() started. rawUri:",
          rawUri.substring(0, 60),
        );

        const cacheDir = Paths.cache.uri;

        // Attempt combined resolve + Ogg Opus conversion (Android only, no temp file)
        const opusPath = `${cacheDir}ekwe_converted_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.ogg`;
        opusPathAttempted = opusPath;
        const combinedResult = await IntentService.resolveAndTranscodeToOpus(
          rawUri,
          opusPath,
        );

        if (isStale) {
          // Superseded before anything was committed; prune any output the
          // native combined transcode may have started writing.
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          return;
        }

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
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          setIsResolving(false);
          setResolveRetryable(false);
          setResolveError(ErrorMessages[EkweError.FILE_TOO_LARGE]);
          logger.warn("[IntentResolver] ❌ FILE_TOO_LARGE rejected by native");
          return;
        }

        // Fallback: separate resolve → validate → convert
        logger.info(
          "[IntentResolver] Combined path not available, using fallback",
        );

        const fileUriResult = await IntentService.resolveToFileUri(rawUri);
        fileUri = fileUriResult;

        if (isStale) {
          // The new source never got committed; remove the content:// copy if it
          // was already written, plus any combined-transcode output, so superseded
          // resolves don't orphan cache files.
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (fileUri) cleanEchoCache(fileUri);
          logger.info(
            "[IntentResolver] Stale after resolveToFileUri — aborting",
          );
          return;
        }

        if (!fileUri) {
          logger.warn("[IntentResolver] resolveToFileUri returned null");
          setIsResolving(false);
          setResolveError("Could not access the shared audio file.");
          return;
        }

        logger.info("[IntentResolver] fileUri resolved:", fileUri);

        const result = await AudioCapture.processSharedFile(
          fileUri,
          mimeType || "audio/*",
        );
        validatedUri = result.ok ? result.value.uri : fileUri;

        // Convert to Opus + extract waveform via native C++
        const convertResult =
          await AudioTranscoder.transcodeToOpus(validatedUri);

        if (isStale) {
          // Nothing was committed to the player; prune the combined output and
          // fallback inputs so a superseded resolve can't leave cache files.
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (fileUri && fileUri !== validatedUri) cleanEchoCache(fileUri);
          if (validatedUri && validatedUri !== fileUri) {
            cleanEchoCache(validatedUri);
          }
          return;
        }

        // Commit the new source BEFORE deleting the previous files, so the
        // in-place player swap never points at a removed file (see the
        // deferred-cleaner contract). The Opus output is preferred; if the
        // conversion failed, the validated copy is the source of truth.
        if (convertResult.ok) {
          const { uri: opusUri, waveform, durationMs } = convertResult.value;
          activeResolvedUri.current = opusUri;
          convertedUriRef.current = opusUri;
          setAudioUri(opusUri);
          setConvertedWaveform(waveform);
          setConvertedDurationMs(durationMs);
          // The committed source is now the Opus file; the content:// copy
          // (`fileUri`) used as the conversion input is no longer referenced
          // and can be removed (it bypasses the player entirely).
          if (fileUri && fileUri !== opusUri) cleanEchoCache(fileUri);
          logger.info(
            "[IntentResolver] ✅ Converted to Opus + waveform extracted",
          );
        } else {
          activeResolvedUri.current = validatedUri;
          logger.warn(
            "[IntentResolver] Opus conversion failed, using original",
          );
          setAudioUri(validatedUri);
        }

        deferredCleanupRef.current.cleanup();

        setIsResolving(false);
        setIsSubsequentIntent(isSubseq);
        logger.info("[IntentResolver] ✅ audioUri set + isResolving=false");
      } catch (err) {
        logger.error("[IntentResolver] ❌ Resolution FAILED:", err);
        // The pipeline threw before committing: prune any transient cache files
        // created this attempt so a persistent failure can't leak storage.
        if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
        if (fileUri) cleanEchoCache(fileUri);
        if (validatedUri && validatedUri !== fileUri) {
          cleanEchoCache(validatedUri);
        }
        // Do not setState if the tree unmounted (or a newer resolve superseded
        // this one) while the promise settled — the UI is gone.
        if (isStale) return;
        setIsResolving(false);
        setResolveError("Could not process the shared audio file.");
      }
    };

    resolve();

    return (): void => {
      isStale = true;
    };
  }, [rawUri, mimeType, hasIOSFiles, retryNonce]);

  return {
    audioUri,
    isResolving,
    convertedWaveform,
    convertedDurationMs,
    resolveError,
    resolveRetryable,
    retryResolve,
    activeResolvedUri,
    isSubsequentIntent,
    setIsSubsequentIntent,
  };
};
