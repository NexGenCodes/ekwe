import { StyleProp, ViewStyle, TextStyle } from 'react-native';

export type EkweButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
export type EkweButtonSize = 'small' | 'medium' | 'large';

export interface EkweButtonProps {
  /** Text label displayed on the button */
  label: string;
  /** Visual variant of the button */
  variant?: EkweButtonVariant;
  /** Size of the button */
  size?: EkweButtonSize;
  /** Optional icon to display on the left or right */
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Whether the button is in a loading state */
  loading?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Callback function when the button is pressed */
  onPress: () => void;
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Optional label style */
  labelStyle?: StyleProp<TextStyle>;
  /** Accessibility label for screen readers */
  accessibilityLabel?: string;
  /** Accessibility hint for screen readers */
  accessibilityHint?: string;
}
