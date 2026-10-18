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

import { AudioCapture } from "@/services/audioCapture";
import { AudioTranscoder } from "@/services/audioTranscoder";
import { IntentService } from "@/services/intentService";
import { default as logger } from "@/utils/logger";
import { cleanEchoCache } from "@/utils/audioCache";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { createDeferredCacheCleaner } from "@/hooks/echo/deferredCacheCleaner";

export const useEchoAudioResolver = (props: {
  audioUri?: string;
  mimeType?: string;
  /** Plan-duration ceiling, enforced natively before decode. */
  maxDurationMs?: number;
}): {
  audioUri: string | undefined;
  /** M4A/AAC-LC copy for playback, produced from the same hard decode as audioUri. */
  playbackUri: string | undefined;
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
  const [audioUri, setAudioUri] = useState<string | undefined>(undefined);
  const [playbackUri, setPlaybackUri] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [convertedWaveform, setConvertedWaveform] = useState<number[]>([]);
  const [convertedDurationMs, setConvertedDurationMs] = useState<number | null>(
    null,
  );
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [resolveRetryable, setResolveRetryable] = useState(true);

  const activeResolvedUri = useRef<string | undefined>(undefined);
  const convertedUriRef = useRef<string | undefined>(undefined);
  const previousRawUri = useRef<string | undefined>(undefined);
  // Render-assigned mirror so the cleanup effect reads the latest playback URI
  // without depending on it (which would re-run resolve).
  const playbackUriRef = useRef<string | undefined>(undefined);
  playbackUriRef.current = playbackUri;

  const deferredCleanupRef = useRef(createDeferredCacheCleaner(cleanEchoCache));

  const [isSubsequentIntent, setIsSubsequentIntent] = useState(false);

  const [retryNonce, setRetryNonce] = useState(0);
  const retryResolve = (): void => {
    previousRawUri.current = undefined;
    setResolveError(null);
    setResolveRetryable(true);
    setRetryNonce((n) => n + 1);
  };

  const rawUri = useMemo(() => props.audioUri, [props.audioUri]);

  const mimeType = useMemo(() => props.mimeType, [props.mimeType]);

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

    deferredCleanupRef.current.remember(
      activeResolvedUri.current,
      convertedUriRef.current,
      playbackUriRef.current,
    );

    const resolve = async (): Promise<void> => {
      let fileUri: string | null = null;
      let validatedUri: string | null = null;
      let opusPathAttempted: string | null = null;
      let playbackPathAttempted: string | null = null;
      try {
        setIsResolving(true);
        setResolveError(null);

        setResolveRetryable(true);
        setConvertedWaveform([]);
        setConvertedDurationMs(null);
        setPlaybackUri(undefined);
        logger.info(
          "[IntentResolver] resolve() started. rawUri:",
          rawUri.substring(0, 60),
        );

        const cacheDir = Paths.cache.uri;

        const opusPath = `${cacheDir}ekwe_converted_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.ogg`;
        opusPathAttempted = opusPath;
        playbackPathAttempted = opusPath.replace(/\.ogg$/, ".m4a");
        const combinedResult = await IntentService.resolveAndTranscodeToOpus(
          rawUri,
          opusPath,
          { maxDurationMs: props.maxDurationMs },
        );

        // DEBUG: `reportedDurationMs` is the native MediaMetadataRetriever value
        // on AUDIO_TOO_LONG, or the decoded duration on success. Remove once the
        // WhatsApp misprobe is confirmed.
        logger.info(
          "[ProbeDebug] combined:",
          JSON.stringify({
            success: combinedResult?.success,
            error: combinedResult?.error,
            reportedDurationMs: combinedResult?.durationMs,
            limitMs: props.maxDurationMs,
            rawUri: rawUri.substring(0, 80),
            opusPath,
          }),
        );

        if (isStale) {
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
          return;
        }

        if (combinedResult && combinedResult.success) {
          deferredCleanupRef.current.cleanup();
          convertedUriRef.current = opusPath;
          activeResolvedUri.current = opusPath;
          setAudioUri(opusPath);
          setPlaybackUri(combinedResult.playbackUri || undefined);
          setConvertedWaveform(combinedResult.waveform);
          setConvertedDurationMs(combinedResult.durationMs);
          setIsResolving(false);
          setIsSubsequentIntent(isSubseq);
          logger.info("[IntentResolver] ✅ Combined resolve+convert succeeded");
          return;
        }

        if (combinedResult && combinedResult.error === "FILE_TOO_LARGE") {
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
          setIsResolving(false);
          setResolveRetryable(false);
          setResolveError(ErrorMessages[EkweError.FILE_TOO_LARGE]);
          logger.warn("[IntentResolver] ❌ FILE_TOO_LARGE rejected by native");
          return;
        }

        if (combinedResult && combinedResult.error === "AUDIO_TOO_LONG") {
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
          setIsResolving(false);
          setResolveRetryable(false);
          setResolveError(ErrorMessages[EkweError.AUDIO_TOO_LONG]);
          logger.warn("[IntentResolver] ❌ AUDIO_TOO_LONG rejected by native");
          // DEBUG: compare the (untrusted) metadata probe against the
          // granule-based probe. A huge metadataProbeMs + sane granuleProbeMs
          // proves the WhatsApp sentinel misprobe. Remove after confirming.
          try {
            const probeFileUri = await IntentService.resolveToFileUri(rawUri);
            const granuleProbeMs = probeFileUri
              ? await IntentService.probeAudioDurationMs(probeFileUri)
              : -1;
            logger.warn(
              "[ProbeDebug] AUDIO_TOO_LONG:",
              JSON.stringify({
                metadataProbeMs: combinedResult?.durationMs,
                granuleProbeMs,
                limitMs: props.maxDurationMs,
                probeFileUri,
              }),
            );
          } catch (probeErr) {
            logger.warn("[ProbeDebug] AUDIO_TOO_LONG probe failed:", probeErr);
          }
          return;
        }

        logger.info(
          "[IntentResolver] Combined path not available, using fallback",
        );

        const fileUriResult = await IntentService.resolveToFileUri(rawUri);
        fileUri = fileUriResult;

        if (isStale) {
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
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

        const convertResult =
          await AudioTranscoder.transcodeToOpus(validatedUri);

        if (isStale) {
          if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
          if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
          if (fileUri && fileUri !== validatedUri) cleanEchoCache(fileUri);
          if (validatedUri && validatedUri !== fileUri) {
            cleanEchoCache(validatedUri);
          }
          return;
        }

        if (convertResult.ok) {
          const { uri: opusUri, waveform, durationMs } = convertResult.value;
          activeResolvedUri.current = opusUri;
          convertedUriRef.current = opusUri;
          setAudioUri(opusUri);
          setConvertedWaveform(waveform);
          setConvertedDurationMs(durationMs);
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

        if (opusPathAttempted) cleanEchoCache(opusPathAttempted);
        if (playbackPathAttempted) cleanEchoCache(playbackPathAttempted);
        if (fileUri) cleanEchoCache(fileUri);
        if (validatedUri && validatedUri !== fileUri) {
          cleanEchoCache(validatedUri);
        }

        if (isStale) return;
        setIsResolving(false);
        setResolveError("Could not process the shared audio file.");
      }
    };

    resolve();

    return (): void => {
      isStale = true;
    };
  }, [rawUri, mimeType, retryNonce, props.maxDurationMs]);

  return {
    audioUri,
    playbackUri,
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
