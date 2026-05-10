import React from 'react';
import { Text } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

interface LensCardProps {
  transcript: string;
}

export function LensCard({ transcript }: LensCardProps): React.ReactElement {
  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      className="p-5 bg-card dark:bg-card-dark rounded-3xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl shadow-zinc-950/20"
    >
      <Text className="font-body text-base text-zinc-950 dark:text-zinc-50 leading-6">
        {transcript}
      </Text>
    </Animated.View>
  );
}
