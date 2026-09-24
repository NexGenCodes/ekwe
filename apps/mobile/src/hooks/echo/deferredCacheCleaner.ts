export interface DeferredCacheCleaner {
  remember: (activeUri?: string, convertedUri?: string) => void;

  cleanup: () => void;
}

export const createDeferredCacheCleaner = (
  deleteUri: (uri: string) => void,
): DeferredCacheCleaner => {
  let prevActive: string | undefined;
  let prevConverted: string | undefined;

  return {
    remember: (active, converted): void => {
      prevActive = active;
      prevConverted = converted;
    },
    cleanup: (): void => {
      if (prevActive) deleteUri(prevActive);
      if (prevConverted) deleteUri(prevConverted);
      prevActive = undefined;
      prevConverted = undefined;
    },
  };
};
