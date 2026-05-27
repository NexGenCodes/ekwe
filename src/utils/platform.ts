import { Platform } from 'react-native';

export type PlatformType = 'ios' | 'android' | 'web';

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';
export const isWeb = Platform.OS === 'web';

export const getPlatform = (): PlatformType => {
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return 'web';
};

/**
 * Executes or returns platform-specific code/values.
 */
export const selectPlatform = <T>(options: { ios: T; android: T; web?: T }): T => {
  if (isIOS) return options.ios;
  if (isAndroid) return options.android;
  return options.web !== undefined ? options.web : options.android;
};
