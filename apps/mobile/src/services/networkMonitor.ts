import NetInfo from "@react-native-community/netinfo";
import { networkActions } from "@/store/network";

let unsubscribeNetInfo: (() => void) | null = null;
let started = false;

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

  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    PUSH_STATE(state);
  });

  NetInfo.fetch()
    .then((state) => PUSH_STATE(state))
    .catch(() => {});
}

export function stopNetworkMonitoring(): void {
  if (!started) return;
  started = false;

  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
}
