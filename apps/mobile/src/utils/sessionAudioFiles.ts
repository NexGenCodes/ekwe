import { useCallback, useMemo, useRef } from "react";

import { cleanAudioArtifacts } from "@/utils/audioCache";

/**
 * Tracks the temp audio files a session owns so they can be purged on unmount
 * or when the work that produced them is discarded.
 *
 * A file only belongs here if it is disposable. Anything that must outlive the
 * session — the persistent voice-preview memo, for one — is deliberately never
 * registered, so `purge` cannot delete it.
 */
export interface SessionAudioFiles {
  remember: (uri?: string | null) => void;
  /** Delayed so a player still holding the file releases it first. */
  deleteAfterDelay: (uri?: string | null) => void;
  purge: () => void;
}

export function useSessionAudioFiles(): SessionAudioFiles {
  const urisRef = useRef<Set<string>>(new Set());

  const remember = useCallback((uri?: string | null): void => {
    if (uri) urisRef.current.add(uri);
  }, []);

  const deleteAfterDelay = useCallback((uri?: string | null): void => {
    if (!uri) return;
    urisRef.current.delete(uri);
    setTimeout((): void => {
      void cleanAudioArtifacts(uri);
    }, 400);
  }, []);

  const purge = useCallback((): void => {
    const uris = Array.from(urisRef.current);
    urisRef.current.clear();
    if (uris.length === 0) return;
    setTimeout((): void => {
      void Promise.all(uris.map((uri) => cleanAudioArtifacts(uri)));
    }, 400);
  }, []);

  // Stable identity: consumers key cleanup effects on this object.
  return useMemo(
    () => ({ remember, deleteAfterDelay, purge }),
    [remember, deleteAfterDelay, purge],
  );
}
