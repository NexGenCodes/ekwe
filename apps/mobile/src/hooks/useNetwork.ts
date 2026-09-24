import { useValue } from "@legendapp/state/react";

import { network$ } from "@/store/network";

export interface NetworkHook {
  isOnline: boolean;
  isOffline: boolean;
  isUnknown: boolean;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export const useNetwork = (): NetworkHook => {
  const isConnected = useValue(() => network$.isConnected.get());
  const isInternetReachable = useValue(() =>
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
