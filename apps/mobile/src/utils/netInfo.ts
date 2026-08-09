import NetInfo from "@react-native-community/netinfo";

import {
  networkActions,
  isDefinitelyOffline,
} from "@/store/network";

/**
 * Utility to check the current network connection state.
 *
 * Fail-safe semantics: returns `false` ONLY when the device is *definitively*
 * offline (isConnected === false or isInternetReachable === false). On first
 * load — and during reachability-probe gaps — NetInfo reports `null`, which
 * must never be treated as offline or the app would block perfectly-good
 * requests on a cold start. "Online" is a hint, not a guarantee: the request
 * itself is the source of truth.
 */
export const checkIsOnline = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  networkActions.set({
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  });
  return !isDefinitelyOffline();
};

export { isDefinitelyOffline };

/**
 * Subscribe to network state changes.
 * Also keeps the shared network store in sync so hooks and services see the
 * same single source of truth.
 * Returns an unsubscribe function.
 */
export const subscribeToNetwork = (
  callback: (isOnline: boolean) => void,
): (() => void) => {
  return NetInfo.addEventListener((state) => {
    networkActions.set({
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
    });
    callback(!isDefinitelyOffline());
  });
};