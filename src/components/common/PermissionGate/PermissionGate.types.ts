import { ViewStyle } from 'react-native';

export interface PermissionGateProps {
  icon: React.ReactElement;
  heading: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: ViewStyle;
}
