import { observable } from "@legendapp/state";

/**
 * Tri-state network status.
 *
 * NetInfo is treated as a *hint*, not a guarantee (see utils/netInfo.ts).
 * - "online"   — the device reports a live, reachable connection.
 * - "offline"  — ONLY when a definitive signal (isConnected === false or
 *                isInternetReachable === false) is reported.
 * - "unknown"  — the first probe hasn't completed yet (nulls). Requests must
 *                NEVER be blocked in this state — the request itself is the
 *                source of truth.
 */
export type NetworkStatus = "online" | "offline" | "unknown";

export interface NetworkInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export const network$ = observable<NetworkInfoState>({
  isConnected: null,
  isInternetReachable: null,
});

/** True only when NetInfo is *definitively* offline. `null` never counts. */
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