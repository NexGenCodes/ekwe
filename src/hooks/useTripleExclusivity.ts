import { useEventListener } from 'expo';
import { useEffect } from 'react';

import EkweNative from '../../modules/ekwe-native';
import { FloatingState } from '../../modules/ekwe-native/src/EkweNative.types';

import { useAudioStore } from '@/store';
import logger from '@/utils/logger';

/**
 * Ensures that the Main App, Ekwe Lens (Bubble), and Ekwe Echo (Share) are mutually exclusive.
 * Rules:
 * 1. Synchronize store based on native UI state machine changes.
 * 2. Lens is automatically removed when app becomes foreground.
 * 3. Lens is hidden when Echo session starts.
 */
export const useTripleExclusivity = (): void => {
  const setActiveFloatingHead = useAudioStore((s) => s.setActiveFloatingHead);

  // NATIVE EVENT BRIDGE: Listen for service lifecycle changes from Kotlin
  useEventListener(
    EkweNative,
    'onStateChanged',
    (event: {
      state: FloatingState;
      previousState: FloatingState;
      reason?: string;
    }) => {
      logger.info(
        `[Exclusivity] Native event: ${event.previousState} -> ${event.state} (${event.reason ?? 'no reason'})`,
      );

      switch (event.state) {
        case 'IDLE':
        case 'HIDDEN_IDLE':
          setActiveFloatingHead('none');
          break;
        case 'BUBBLE_VISIBLE':
        case 'BUBBLE_EXPANDED':
          setActiveFloatingHead('bubble');
          break;
        case 'OVERLAY_ACTIVE':
          setActiveFloatingHead('card');
          break;
      }
    },
  );

  useEventListener(EkweNative, 'onAppForeground', (): void => {
    logger.info('[Exclusivity] App foregrounded (Native sync)');
    // Native module auto-removes the bubble if it was visible
  });

  useEventListener(EkweNative, 'onAppBackground', (): void => {
    logger.info('[Exclusivity] App backgrounded (Native sync)');
  });

  useEventListener(
    EkweNative,
    'onIntentQueued',
    (event: { audioPath: string; sourceApp: string }): void => {
      logger.info(
        `[Exclusivity] Intent queued while active: ${event.audioPath} from ${event.sourceApp}`,
      );
      // Future: show a toast or badge on the UI or Bubble indicating a queued share.
    },
  );

  // INITIAL STATE SYNC: On startup, ensure we start with an accurate view of native state
  useEffect(() => {
    EkweNative.getWindowState().then((state: string): void => {
      logger.info('[Exclusivity] Startup Sync: current native state =', state);
      switch (state) {
        case 'IDLE':
        case 'HIDDEN_IDLE':
          setActiveFloatingHead('none');
          break;
        case 'BUBBLE_VISIBLE':
        case 'BUBBLE_EXPANDED':
          setActiveFloatingHead('bubble');
          break;
        case 'OVERLAY_ACTIVE':
          setActiveFloatingHead('card');
          break;
      }
    });
  }, [setActiveFloatingHead]);
};
