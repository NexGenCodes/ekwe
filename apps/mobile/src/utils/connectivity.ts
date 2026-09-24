import NetInfo from "@react-native-community/netinfo";

import { networkActions, isDefinitelyOffline } from "@/store/network";

export const checkIsOnline = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  networkActions.set({
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  });
  return !isDefinitelyOffline();
};

export { isDefinitelyOffline };

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
