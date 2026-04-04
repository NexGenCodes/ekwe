import { StyleProp, ViewStyle } from 'react-native';

export interface ThemeTogglerProps {
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label override */
  accessibilityLabel?: string;
}
