import { useSelector } from "@legendapp/state/react";

import { network$ } from "@/store/network";

export interface NetworkHook {
  isOnline: boolean;
  isOffline: boolean;
  isUnknown: boolean;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/**
 * Reactive tri-state network hook backed by the shared `network$` store
 * (seeded by the single subscription in services/networkMonitor.ts).
 *
 * `isOffline` is true ONLY on a definitive disconnect — a `null` (first
 * probe / transient gap) is reported as `isUnknown`, never as offline.
 */
export const useNetwork = (): NetworkHook => {
  const isConnected = useSelector(() => network$.isConnected.get());
  const isInternetReachable = useSelector(() =>
    network$.isInternetReachable.get(),
  );

  const isOffline = isConnected === false || isInternetReachable === false;
  const isUnknown =
    !isOffline && (isConnected === null || isInternetReachable === null);

  return {
    isOnline: !isOffline && !isUnknown,
    isOffline,
    isUnknown,
    isConnected,
    isInternetReachable,
  };
};
