export interface DeferredCacheCleaner {
  remember: (
    activeUri?: string,
    convertedUri?: string,
    playbackUri?: string,
  ) => void;

  cleanup: () => void;
}

export const createDeferredCacheCleaner = (
  deleteUri: (uri: string) => void,
): DeferredCacheCleaner => {
  let prevActive: string | undefined;
  let prevConverted: string | undefined;
  let prevPlayback: string | undefined;

  return {
    remember: (active, converted, playback): void => {
      prevActive = active;
      prevConverted = converted;
      prevPlayback = playback;
    },
    cleanup: (): void => {
      if (prevActive) deleteUri(prevActive);
      if (prevConverted) deleteUri(prevConverted);
      if (prevPlayback) deleteUri(prevPlayback);
      prevActive = undefined;
      prevConverted = undefined;
      prevPlayback = undefined;
    },
  };
};
