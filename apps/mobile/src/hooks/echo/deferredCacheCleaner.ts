/**
 * Defers deletion of previously-resolved playback files until a replacement has
 * been committed.
 *
 * The Echo player hot-swaps its source in-place (`player.replace()`), so a file
 * must never be deleted while the player might still reference it. This helper
 * captures the previous URIs on each new intent and exposes a single `cleanup()`
 * that the caller runs ONLY after the new source has been successfully resolved
 * and swapped in. It is unit-testable and keeps the deferred-cleanup ordering
 * explicit.
 */
export interface DeferredCacheCleaner {
  /** Remember the previously-resolved files for a (potential) later cleanup. */
  remember: (activeUri?: string, convertedUri?: string) => void;
  /**
   * Delete the remembered files and forget them. Safe to call when there is
   * nothing remembered. Never deletes the contents passed to `remember` after
   * the current call has already run (idempotent).
   */
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