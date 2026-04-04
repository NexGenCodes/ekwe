import React from 'react';
import { ViewProps } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

interface HighContrastCardProps extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

export const HighContrastCard = ({
  children,
  className = '',
  style,
  ...props
}: HighContrastCardProps): React.ReactElement => {
  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      className={`bg-zinc-950/40 dark:bg-black/60 border border-zinc-200/50 dark:border-zinc-800/80 rounded-3xl p-5 shadow-2xl shadow-zinc-950/20 ${className}`}
      style={style}
      {...props}
    >
      {children}
    </Animated.View>
  );
};
