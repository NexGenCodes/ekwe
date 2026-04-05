import { Platform } from 'react-native';

import { BubbleOverlay as AndroidBubble } from './BubbleOverlay.android';
import { BubbleOverlay as IosBubble } from './BubbleOverlay.ios';

export const BubbleOverlay =
  Platform.OS === 'android' ? AndroidBubble : IosBubble;
