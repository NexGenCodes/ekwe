/**
 * Network Monitor — the app's single NetInfo subscription.
 *
 * Every other consumer (hooks, services, and TanStack Query) reads the same
 * tri-state store (`network$`) or TanStack's `onlineManager`. We keep exactly
 * one source of truth so "am I offline?" never answers differently in two
 * places (the old code disagreed on what a `null` meant).
 *
 * It wires:
 *   1. `network$` — the tri-state store used by `checkIsOnline`,
 *      `useNetwork`, and the service fail-fast guards.
 *   2. `onlineManager` — so TanStack Query's `networkMode: "online"` actually
 *      works in React Native (pausing/refetching on device reconnect), which
 *      the browser-only default never observes on a phone.
 *   3. `focusManager` — maps React Native's AppState to focus, replacing the
 *      missing window-focus events (used only if `refetchOnWindowFocus` is on).
 */
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

import { networkActions } from "@/store/network";

let started = false;
let focusWired = false;

const PUSH_STATE = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): void => {
  networkActions.set({
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  });
};

export function initNetworkMonitoring(): void {
  if (started) return;
  started = true;

  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      PUSH_STATE(state);
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
  });

  // Seed the store immediately so the first render (and any early request)
  // sees a real state instead of lingering "unknown" nulls.
  NetInfo.fetch()
    .then((state) => PUSH_STATE(state))
    .catch(() => {
      /* native module unavailable — store stays "unknown", which is fail-safe */
    });

  if (!focusWired && Platform.OS !== "web") {
    focusWired = true;
    focusManager.setEventListener((handleFocus) => {
      const subscription = AppState.addEventListener(
        "change",
        (state): void => {
          handleFocus(state === "active");
        },
      );
      return (): void => subscription.remove();
    });
  }
}

export function stopNetworkMonitoring(): void {
  if (!started) return;
  started = false;
  // Reset to no-op listeners (the param is a required setup fn, not nullable);
  // on native the callbacks simply won't fire, which is correct for teardown.
  onlineManager.setEventListener(() => undefined);
  focusManager.setEventListener(() => undefined);
}
