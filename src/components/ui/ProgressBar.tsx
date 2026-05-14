import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/hooks';

export interface ProgressBarProps {
  /** Value between 0 and 1 */
  progress: number;
  /** Override fill color (defaults to primary) */
  fillColor?: string;
  /** Override track color (defaults to border) */
  trackColor?: string;
  /** Bar height in px */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * ProgressBar — Simple horizontal fill bar.
 * Used for billing usage, download progress, etc.
 */
export const ProgressBar = ({
  progress,
  fillColor,
  trackColor,
  height = 8,
  style,
}: ProgressBarProps): React.ReactElement => {
  const { color } = useTheme();
  const clampedProgress = Math.max(0, Math.min(1, progress));

  return (
    <View
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor || color.border,
          overflow: 'hidden',
          width: '100%',
        },
        style,
      ]}
    >
      <View
        style={{
          height: '100%',
          width: `${clampedProgress * 100}%`,
          borderRadius: height / 2,
          backgroundColor: fillColor || color.primary,
        }}
      />
    </View>
  );
};
