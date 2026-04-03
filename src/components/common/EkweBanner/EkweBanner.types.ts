import { StyleProp, ViewStyle } from 'react-native';

export type EkweBannerVariant = 'info' | 'success' | 'warning' | 'error';

export interface EkweBannerProps {
  /** Title of the banner */
  title: string;
  /** Main message content */
  message?: string;
  /** Visual variant affecting colors and icons */
  variant?: EkweBannerVariant;
  /** Whether the banner is currently visible */
  visible: boolean;
  /** Callback for when the close button is pressed */
  onClose?: () => void;
  /** Auto-hide duration in milliseconds (optional) */
  duration?: number;
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
}
