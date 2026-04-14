import { useState, useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import EkweNative from '../../modules/ekwe-native';

import {
  AppStrategy,
  getStrategyForApp,
  DEFAULT_STRATEGY,
} from '@/constants/appStrategies';

export interface UseForegroundAppResult {
  strategy: AppStrategy;
  hasPermission: boolean | null;
  requestPermission: () => Promise<void>;
  checkPermission: () => Promise<boolean | undefined>;
}

export const useForegroundApp = (
  enabled: boolean = true,
): UseForegroundAppResult => {
  const [strategy, setStrategy] = useState<AppStrategy>(DEFAULT_STRATEGY);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const checkPermission = async (): Promise<boolean | undefined> => {
    if (Platform.OS !== 'android') return;
    const granted = await EkweNative.isAccessibilityEnabled();
    setHasPermission(granted);
    return granted;
  };

  useEffect(() => {
    checkPermission();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkPermission();
    });

    // Listen for real-time app changes from native AccessibilityService
    interface Subscription {
      remove(): void;
    }
    let eventSub: Subscription | undefined;
    if (Platform.OS === 'android' && enabled) {
      eventSub = EkweNative.addListener(
        'onForegroundAppChanged',
        ({ packageName }: { packageName: string }) => {
          const newStrategy = getStrategyForApp(packageName);
          setStrategy((prevStrategy) =>
            prevStrategy.packageName !== newStrategy.packageName
              ? newStrategy
              : prevStrategy,
          );
        },
      );
    }

    return (): void => {
      sub.remove();
      if (eventSub) eventSub.remove();
    };
  }, [enabled]);

  return {
    strategy,
    hasPermission,
    requestPermission: EkweNative.requestAccessibilityPermission,
    checkPermission,
  };
};
