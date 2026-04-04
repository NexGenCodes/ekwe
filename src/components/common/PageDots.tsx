import React from 'react';
import { View } from 'react-native';

interface PageDotsProps {
  total: number;
  active: number;
}

export const PageDots = ({
  total,
  active,
}: PageDotsProps): React.ReactElement => {
  return (
    <View className="flex-row items-center justify-center gap-3">
      {Array.from({ length: total }).map((_, i) => {
        const isActive = i === active;

        return (
          <View
            key={i}
            className={`h-1.5 rounded-full ${
              isActive
                ? 'w-8 bg-primary dark:bg-primary-dark'
                : 'w-1.5 bg-zinc-300 dark:bg-zinc-800'
            }`}
          />
        );
      })}
    </View>
  );
};
