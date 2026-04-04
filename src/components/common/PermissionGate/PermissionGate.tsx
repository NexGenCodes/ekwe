import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';

import { PermissionGateProps } from './PermissionGate.types';

export const PermissionGate = ({
  icon,
  heading,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  style,
}: PermissionGateProps): React.ReactElement => {
  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      style={style}
    >
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-[300px] items-center">
          <View className="mb-4">{icon}</View>

          <Text className="text-center font-bodyMed text-xl leading-6 text-zinc-950 dark:text-zinc-50 mt-4">
            {heading}
          </Text>

          <Text className="text-center max-w-[280px] font-body text-base leading-6 text-zinc-600 dark:text-zinc-400 mt-3">
            {body}
          </Text>

          <EkweButton
            variant="primary"
            size="large"
            label={primaryLabel}
            onPress={onPrimary}
            className="w-full mt-8"
          />

          {secondaryLabel && onSecondary && (
            <EkweButton
              variant="ghost"
              size="medium"
              label={secondaryLabel}
              onPress={onSecondary}
              className="w-full mt-3"
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};
