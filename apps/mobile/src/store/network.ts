import { observable } from "@legendapp/state";

export type NetworkStatus = "online" | "offline" | "unknown";

export interface NetworkInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export const network$ = observable<NetworkInfoState>({
  isConnected: null,
  isInternetReachable: null,
});

export function isDefinitelyOffline(): boolean {
  const state = network$.peek();
  return state.isConnected === false || state.isInternetReachable === false;
}

export function getNetworkStatus(): NetworkStatus {
  if (isDefinitelyOffline()) return "offline";
  const state = network$.peek();
  if (state.isConnected === null || state.isInternetReachable === null) {
    return "unknown";
  }
  return "online";
}

export const networkActions = {
  set: (state: NetworkInfoState): void => {
    network$.set(state);
  },
};
