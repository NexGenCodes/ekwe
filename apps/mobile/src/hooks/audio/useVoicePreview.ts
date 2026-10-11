import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VOICE_PREVIEW_TEXT } from "@ekwe/shared";

import { EkweError } from "@/constants/errors";
import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { synthesizeSpeech } from "@/services/speech";
import { addSentryBreadcrumb } from "@/utils/logger";
import type { SessionAudioFiles } from "@/utils/sessionAudioFiles";
import type { VoiceSelection } from "@/utils/voices";
import { getCachedPreviewUri, persistPreview } from "@/utils/voicePreviewCache";

/** Loading while clip is fetching/decoding, playing once audible. */
export type PreviewPhase = "loading" | "playing";

export interface VoicePreviewController {
  /** The voice currently loading or playing, as `${slotId}_${gender}`. */
  activeKey: string | null;
  phase: PreviewPhase | null;
  /** Auditions a voice, or stops it when it is already the active one. */
  preview: (selection: VoiceSelection) => void;
  /** Stops playback and invalidates any in-flight request. Keeps the memo. */
  cancel: () => void;
  /** Cancels and deletes the session's temp file. Keeps the memo. */
  reset: () => void;
}

const previewKey = (slotId: string, gender: string, lang: string): string =>
  `${slotId}_${gender}_${lang}`;

export const useVoicePreview = ({
  lang,
  files,
  onError,
}: {
  lang: string;
  files: SessionAudioFiles;
  onError: (error: EkweError) => void;
}): VoicePreviewController => {
  const [uri, setUri] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const player = useSharedAudioPlayer(uri);
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  /** Invalidates in-flight requests by incrementing the sequence number. */
  const seqRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);
  const loadingKeyRef = useRef<string | null>(null);
  /** The session temp file URI for the current clip. */
  const tempUriRef = useRef<string | null>(null);
  useEffect(() => {
    activeKeyRef.current = activeKey;
    loadingKeyRef.current = loadingKey;
  });

  const stopAndClear = useCallback((): void => {
    seqRef.current += 1;
    playerRef.current.pause();
    setActiveKey(null);
    setLoadingKey(null);
    setUri(null);
  }, []);

  // Autoplay once the clip is both fetched and decoded. Keyed on the loading
  // slot rather than the URI so a discarded request can never reach playback.
  const phase: PreviewPhase | null = loadingKey
    ? "loading"
    : activeKey
      ? "playing"
      : null;

  // The player controller is a fresh object on every native status tick, so
  // the effect depends on the primitives it reads rather than on the object.
  // `isReady` rather than `isLoaded`: the source swap is asynchronous, so
  // `isLoaded` is briefly stale-true for the previous clip.
  const isReady = player.isReady;
  const isDecoding = player.isDecoding;
  // Read in the render body, not via `playerRef`: playback state must drive a
  // re-render so the toggle below sees the clip as audible rather than reading
  // a pre-playback snapshot.
  const isPlaying = player.isPlaying;
  useEffect(() => {
    if (phase !== "loading" || !uri) return;
    if (!isReady || isDecoding) return;
    setLoadingKey(null);
    void playerRef.current.playFromStart();
  }, [phase, uri, isReady, isDecoding]);

  const runPreview = useCallback(
    async (selection: VoiceSelection): Promise<void> => {
      const key = previewKey(selection.slot.id, selection.gender, lang);
      const seq = ++seqRef.current;

      // Whatever was sounding stops, so two voices never overlap.
      playerRef.current.pause();
      setLoadingKey(key);
      setActiveKey(key);

      const memoized = getCachedPreviewUri(key);
      if (memoized) {
        addSentryBreadcrumb("voice-preview", "cache-hit", { key });
        if (seq !== seqRef.current) return;
        tempUriRef.current = null;
        setUri(memoized);
        return;
      }

      addSentryBreadcrumb("voice-preview", "cache-miss", { key, lang });

      const result = await synthesizeSpeech(VOICE_PREVIEW_TEXT, lang, {
        voiceId: selection.slot.id,
        gender: selection.gender,
        // Use playback delivery to skip Ogg normalization for non-shared previews.
        delivery: "playback",
        // Omit reroll for stable cache keys and one-time provider cost.
        isPreview: true,
      });

      if (seq !== seqRef.current) {
        // A newer tap or a tab switch won; this clip is dead on arrival.
        if (result.ok) files.deleteAfterDelay(result.value.uri);
        return;
      }

      if (!result.ok) {
        setLoadingKey(null);
        setActiveKey(null);
        onError(result.error);
        return;
      }

      tempUriRef.current = result.value.uri;
      const persisted = await persistPreview(result.value.uri, key);
      if (seq !== seqRef.current) {
        // The move already happened, so `persisted` is the file on disk.
        files.deleteAfterDelay(persisted);
        return;
      }

      // The temp file became the memo; only clean up when the move failed.
      const stored = persisted !== result.value.uri;
      tempUriRef.current = stored ? null : persisted;
      addSentryBreadcrumb("voice-preview", stored ? "memoized" : "not-stored", {
        key,
      });
      if (!stored) {
        files.deleteAfterDelay(result.value.uri);
      }
      setUri(persisted);
      // `loadingKey` is deliberately left set: clearing it here would batch
      // with `setUri` and skip the autoplay effect, leaving the clip silent.
    },
    [lang, files, onError],
  );

  const preview = useCallback(
    (selection: VoiceSelection): void => {
      const key = previewKey(selection.slot.id, selection.gender, lang);
      const isActive = activeKeyRef.current === key;
      if (isActive && (isPlaying || loadingKeyRef.current === key)) {
        stopAndClear();
        return;
      }
      void runPreview(selection);
    },
    [runPreview, stopAndClear, isPlaying, lang],
  );

  const cancel = useCallback((): void => {
    stopAndClear();
  }, [stopAndClear]);

  const reset = useCallback((): void => {
    const temp = tempUriRef.current;
    tempUriRef.current = null;
    stopAndClear();
    files.deleteAfterDelay(temp);
  }, [files, stopAndClear]);

  useEffect(() => {
    return (): void => {
      playerRef.current.pause();
    };
  }, []);

  return useMemo(
    () => ({ activeKey, phase, preview, cancel, reset }),
    [activeKey, phase, preview, cancel, reset],
  );
};
