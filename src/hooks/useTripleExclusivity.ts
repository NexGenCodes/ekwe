import { useEventListener } from 'expo';
import { useEffect } from 'react';

import EkweNative from '../../modules/ekwe-native';

import { useAudioStore } from '@/store';
import { FloatingState } from '../../modules/ekwe-native/src/EkweNative.types';

/**
 * Ensures that the Main App, Ekwe Lens (Bubble), and Ekwe Echo (Share) are mutually exclusive.
 * Rules:
 * 1. Synchronize store based on native UI state machine changes.
 * 2. Lens is automatically removed when app becomes foreground.
 * 3. Lens is hidden when Echo session starts.
 */
export const useTripleExclusivity = () => {
  const setActiveFloatingHead = useAudioStore((s) => s.setActiveFloatingHead);

  // NATIVE EVENT BRIDGE: Listen for service lifecycle changes from Kotlin
  useEventListener(
    EkweNative,
    'onStateChanged',
    (event: { state: FloatingState; previousState: FloatingState; reason?: string }) => {
      console.log(
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

  useEventListener(EkweNative, 'onAppForeground', () => {
     console.log('[Exclusivity] App foregrounded (Native sync)');
     // Native module auto-removes the bubble if it was visible
  });

  useEventListener(EkweNative, 'onAppBackground', () => {
     console.log('[Exclusivity] App backgrounded (Native sync)');
  });

  useEventListener(EkweNative, 'onIntentQueued', (event: { audioPath: string; sourceApp: string }) => {
      console.log(`[Exclusivity] Intent queued while active: ${event.audioPath} from ${event.sourceApp}`);
      // Future: show a toast or badge on the UI or Bubble indicating a queued share.
  });

  // INITIAL STATE SYNC: On startup, ensure we start with an accurate view of native state
  useEffect(() => {
    EkweNative.getWindowState().then((state) => {
      console.log('[Exclusivity] Startup Sync: current native state =', state);
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
