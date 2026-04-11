import { useEventListener } from 'expo';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import EkweNative from '../../modules/ekwe-native';

import { useAudioStore } from '@/store';
import { BubbleNative } from '@/utils/BubbleModule';

/**
 * Ensures that the Main App, Magic Bubble, and Share Card are mutually exclusive.
 * Rules:
 * 1. If App becomes 'active' (foreground) -> Kill Bubble Service and clear activeFloatingHead.
 * 2. If activeFloatingHead is 'card' -> Suppress any 'bubble' logic.
 * 3. If native service dies (timeout, OS kill) -> Reset JS state immediately.
 */
export const useTripleExclusivity = () => {
  const activeFloatingHead = useAudioStore((s) => s.activeFloatingHead);
  const setActiveFloatingHead = useAudioStore((s) => s.setActiveFloatingHead);
  const showOverlay = useAudioStore((s) => s.showOverlay);

  // NATIVE EVENT BRIDGE: Listen for service lifecycle changes from Kotlin
  useEventListener(
    EkweNative,
    'onBubbleStateChanged',
    (event: { state: string; reason?: string }) => {
      console.log(
        `[Exclusivity] Native event: ${event.state} (${event.reason ?? 'no reason'})`,
      );

      if (event.state === 'STOPPED') {
        // Only reset if we're currently in bubble mode — don't clobber card/overlay state
        const current = useAudioStore.getState().activeFloatingHead;
        if (current === 'bubble') {
          setActiveFloatingHead('none');
        }
      }
    },
  );

  // ZOMBIE SYNC: On startup, ensure we start with a clean native slate
  useEffect(() => {
    if (Platform.OS === 'android' && !showOverlay) {
      console.log('[Exclusivity] Startup Sync: Cleaning up orphaned services');
      BubbleNative.stopBubbleService().catch(() => {});
      setActiveFloatingHead('none');
    }
  }, []); // Only once at boot

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        // App is foregrounded — kill all floating entities
        console.log('[Exclusivity] App turned active — cleaning up heads');

        if (Platform.OS === 'android') {
          // Force stop the service to remove any windows
          // (native module will emit STOPPED event, but we also set state here for speed)
          BubbleNative.stopBubbleService().catch(() => {});
        } else {
          // TODO: Kill iOS Live Activities via ActivityKit once bridged
        }

        // Reset store state
        setActiveFloatingHead('none');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [setActiveFloatingHead]);

  // If the JS-based overlay is active, ensure the native state matches 'card'
  useEffect(() => {
    if (showOverlay && activeFloatingHead !== 'card') {
      setActiveFloatingHead('card');
    }
  }, [showOverlay, activeFloatingHead, setActiveFloatingHead]);
};
