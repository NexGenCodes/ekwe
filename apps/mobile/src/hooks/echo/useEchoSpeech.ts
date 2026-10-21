import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VoiceGender } from "@ekwe/shared";

import { pauseActiveAudio } from "@/hooks/audio/audioFocus";
import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import { synthesizeSpeech } from "@/services/speech";
import { EkweError } from "@/constants/errors";
import { settings$ } from "@/store/settings";
import { cleanEchoCache } from "@/utils/audioCache";
import {
  echoSpeechCacheKey,
  getCachedEchoSpeechUri,
  persistEchoSpeech,
} from "@/utils/echoSpeechCache";
import { addSentryBreadcrumb } from "@/utils/logger";
import { AnalyticsEvents, track } from "@/utils/analytics";

export interface EchoSpeechController {
  /** True while synthesis is in flight or a clip is audibly playing. */
  isBusy: boolean;
  /** True while a clip is audibly playing (or about to be). */
  isSpeaking: boolean;
  /** True while synthesis is in flight. */
  isLoading: boolean;
  /**
   * Synthesizes (or replays from memo) the given text. No-op while busy.
   * Stable across renders — always call through the controller, never
   * capture it in a long-lived closure without a ref.
   */
  speak: (text: string, lang: string) => void;
  /** Stops playback and discards any in-flight request. Keeps the memo. */
  stop: () => void;
}

const resolveGender = (): VoiceGender | undefined => {
  const value = settings$.voiceGender.peek();
  return value === "default" ? undefined : value;
};

const resolveVoiceId = (): string | undefined =>
  settings$.voiceId.peek() ?? undefined;

export const useEchoSpeech = ({
  onError,
}: {
  onError: (error: EkweError) => void;
}): EchoSpeechController => {
  const [uri, setUri] = useState<string | null>(null);
  /**
   * The clip that owns the in-flight request. Null while synthesizing, and
   * the only URI the autoplay effect will start. This prevents the previous
   * clip (still reported ready) from replaying when a new request begins —
   * the exact race that broke replay in the original TextBox implementation.
   */
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const player = useSharedAudioPlayer(uri);
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  /** Invalidates in-flight requests by incrementing the sequence number. */
  const seqRef = useRef(0);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const stop = useCallback((): void => {
    seqRef.current += 1;
    playerRef.current.pause();
    setPendingUri(null);
    setIsLoading(false);
    setIsSpeaking(false);
  }, []);

  const isReady = player.isReady;
  const isDecoding = player.isDecoding;
  const isEnded = player.isEnded;
  const loadError = player.loadError;

  // A native load failure never reaches `isReady`, which would strand the
  // loading state forever. Fail instead of spinning.
  useEffect(() => {
    if (!loadError) return;
    stop();
    onErrorRef.current(EkweError.SPEECH_FAIL);
  }, [loadError, stop]);

  // Reset the speaking flag when playback ends so the button reverts to
  // the Volume2 icon and the next tap replays.
  useEffect(() => {
    if (isSpeaking && isEnded) {
      playerRef.current.pause();
      setIsSpeaking(false);
    }
  }, [isSpeaking, isEnded]);

  // Autoplay once the clip that owns the request is fetched and decoded.
  // Keyed on `pendingUri` rather than `uri` so a discarded request can never
  // reach playback, and a stale ready clip cannot replay on a new request.
  useEffect(() => {
    if (!isLoading) return;
    if (!uri || uri !== pendingUri) return;
    if (!isReady || isDecoding) return;
    setPendingUri(null);
    setIsLoading(false);
    setIsSpeaking(true);
    void playerRef.current.playFromStart();
  }, [isLoading, uri, pendingUri, isReady, isDecoding]);

  const speak = useCallback(
    (text: string, lang: string): void => {
      if (isLoading || isSpeaking) return;
      const trimmed = text.trim();
      if (!trimmed || !lang) return;

      const seq = ++seqRef.current;

      // Whatever was sounding stops. The speech player claims audio focus
      // when it actually starts, so we only pause here — a pre-claim would
      // make it pause itself and abort the start.
      playerRef.current.pause();
      pauseActiveAudio();

      setPendingUri(null);
      setIsLoading(true);
      track(AnalyticsEvents.SPEECH_PLAYED, { source: "echo", lang });

      const voiceId = resolveVoiceId();
      const gender = resolveGender();
      const memoKey = echoSpeechCacheKey(
        `${trimmed}\u0000${lang}\u0000${voiceId ?? ""}\u0000${gender ?? ""}`,
      );

      const memoized = getCachedEchoSpeechUri(memoKey);
      if (memoized) {
        addSentryBreadcrumb("echo-speech", "cache-hit", { key: memoKey });
        setUri(memoized);
        setPendingUri(memoized);
        return;
      }

      addSentryBreadcrumb("echo-speech", "cache-miss", { key: memoKey });

      void (async (): Promise<void> => {
        const result = await synthesizeSpeech(trimmed, lang, {
          delivery: "playback",
          voiceId,
          gender,
        });

        if (seq !== seqRef.current) {
          // A newer tap or a text change won; this clip is dead on arrival.
          if (result.ok) void cleanEchoCache(result.value.uri);
          return;
        }

        if (!result.ok) {
          setIsLoading(false);
          onErrorRef.current(result.error);
          return;
        }

        const persisted = await persistEchoSpeech(result.value.uri, memoKey);
        if (seq !== seqRef.current) {
          // The move already happened, so `persisted` is the file on disk.
          if (persisted !== result.value.uri) void cleanEchoCache(persisted);
          return;
        }

        // When the move failed, `persisted` is the temp file. Leave it for
        // the startup sweep — deleting it here would race with the player
        // still opening it on some devices.
        setUri(persisted);
        setPendingUri(persisted);
        // `isLoading` is deliberately left set: clearing it here would batch
        // with `setUri` and skip the autoplay effect, leaving the clip silent.
      })();
    },
    [isLoading, isSpeaking],
  );

  const isBusy = isLoading || isSpeaking;

  return useMemo(
    () => ({ isBusy, isSpeaking, isLoading, speak, stop }),
    [isBusy, isSpeaking, isLoading, speak, stop],
  );
};
