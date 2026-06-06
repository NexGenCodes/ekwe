import NetInfo from "@react-native-community/netinfo";

/**
 * Utility to check the current network connection state.
 */
export const checkIsOnline = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  // isInternetReachable can be null on first load, so we ensure it's not explicitly false
  return !!state.isConnected && state.isInternetReachable !== false;
};

/**
 * Subscribe to network state changes.
 * Returns an unsubscribe function.
 */
export const subscribeToNetwork = (
  callback: (isOnline: boolean) => void,
): (() => void) => {
  return NetInfo.addEventListener((state) => {
    callback(!!state.isConnected && state.isInternetReachable !== false);
  });
};
