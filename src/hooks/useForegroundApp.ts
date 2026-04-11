import EkweNative from 'modules/ekwe-native';
import { useState, useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import {
  AppStrategy,
  getStrategyForApp,
  DEFAULT_STRATEGY,
} from '@/constants/appStrategies';

export const useForegroundApp = (enabled: boolean = true) => {
  const [strategy, setStrategy] = useState<AppStrategy>(DEFAULT_STRATEGY);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const checkPermission = async () => {
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
    let eventSub: any;
    if (Platform.OS === 'android' && enabled) {
      eventSub = EkweNative.addListener(
        'onForegroundAppChanged',
        ({ packageName }) => {
          const newStrategy = getStrategyForApp(packageName);
          if (newStrategy.packageName !== strategy.packageName) {
            setStrategy(newStrategy);
          }
        },
      );
    }

    return () => {
      sub.remove();
      if (eventSub) eventSub.remove();
    };
  }, [enabled, strategy.packageName]);

  return {
    strategy,
    hasPermission,
    requestPermission: EkweNative.requestAccessibilityPermission,
    checkPermission,
  };
};
