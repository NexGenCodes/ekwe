import { useEffect, useMemo, useRef } from "react";

import {
  SharedAudioPlayer,
  useSharedAudioPlayer,
} from "./useSharedAudioPlayer";

export interface WaveformPlaybackOptions {
  /**
   * When `false`, playback is paused so audio stops when the user leaves the
   * step/slide that owns playback (position is retained for returning).
   */
  active?: boolean;
  /**
   * Authoritative duration (ms) of the source, computed natively from decoded
   * PCM. Used as the waveform/seek timebase so playback never appears to "run
   * past the end" when the player's parsed Ogg duration under-reports.
   */
  durationMs?: number | null;
}

export interface WaveformPlaybackController extends SharedAudioPlayer {
  peaks: number[];
}

/**
 * Owns the audio player + the decoded waveform for the Echo Preview slide.
 *
 * Handles the full playback lifecycle: play/pause, seek, scrub-timer
 * coordination (via `useSharedAudioPlayer`), and automatically pauses audio
 * whenever `active` becomes false so sound never leaks past the slide.
 *
 * NOTE: `useSharedAudioPlayer` returns a fresh object each render, so we never
 * key effects off its identity — otherwise cleanup would fire on every render
 * and demolish the native player. We mirror the handle into a ref instead.
 */
export const useAudioWaveformPlayback = (
  uri: string | null,
  peaks: number[],
  options: WaveformPlaybackOptions = {},
): WaveformPlaybackController => {
  const player = useSharedAudioPlayer(uri, options.durationMs);

  const active = options.active ?? true;

  // Track the latest controller in a ref so effects can read current values
  // without being re-run by identity churn.
  const playerRef = useRef<SharedAudioPlayer>(player);
  playerRef.current = player;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Stop playback when leaving the owning step (position retained). Only
  // reacts to @active transitions.
  useEffect(() => {
    if (!active) {
      playerRef.current.pause();
    }
  }, [active]);

  // Memoize the merged controller so identity only churns when the underlying
  // player controller or `peaks` actually change. Without this the per-render
  // `{ ...player, peaks }` spread below would hand memoized step components a
  // brand-new prop object on EVERY parent render (~2Hz status ticks), silently
  // undoing their React.memo boundary.
  return useMemo(() => ({ ...player, peaks }), [player, peaks]);
};
