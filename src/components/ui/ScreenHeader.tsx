import { useRouter } from 'expo-router';
import React from 'react';
import { View, Text } from 'react-native';

import { Button } from './Button';

export interface ScreenHeaderProps {
  title: string;
}

export const ScreenHeader = ({
  title,
}: ScreenHeaderProps): React.ReactElement => {
  const router = useRouter();

  return (
    <View className="px-6 py-4 flex-row justify-between items-center bg-background dark:bg-background border-b border-border dark:border-border">
      <Text className="font-display text-xl text-foreground dark:text-foreground">
        {title}
      </Text>
      <Button
        variant="ghost"
        size="small"
        label="Close"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/');
          }
        }}
      />
    </View>
  );
};
