import { useEffect, useMemo, useRef } from "react";

import {
  SharedAudioPlayer,
  useSharedAudioPlayer,
} from "@/hooks/audio/useSharedAudioPlayer";

export interface WaveformPlaybackOptions {
  active?: boolean;

  durationMs?: number | null;
}

export interface WaveformPlaybackController extends SharedAudioPlayer {
  peaks: number[];
}

export const useAudioWaveformPlayback = (
  uri: string | null,
  peaks: number[],
  options: WaveformPlaybackOptions = {},
): WaveformPlaybackController => {
  const player = useSharedAudioPlayer(uri, options.durationMs);

  const active = options.active ?? true;

  const playerRef = useRef<SharedAudioPlayer>(player);
  playerRef.current = player;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) {
      playerRef.current.pause();
    }
  }, [active]);

  return useMemo(() => ({ ...player, peaks }), [player, peaks]);
};
