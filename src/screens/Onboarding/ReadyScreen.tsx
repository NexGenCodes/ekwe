import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { ReactElement } from 'react';
import { View, Text } from 'react-native';
import { useMMKVString } from 'react-native-mmkv';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { EkweButton } from 'src/components/common/EkweButton';
import { RootStackParamList } from 'src/navigation/RootNavigator';
import { useSettingsStore } from 'src/store';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const ReadyScreen = (): ReactElement => {
  const navigation = useNavigation<Nav>();
  const [, setOnboardingDone] = useMMKVString('onboarding_complete');
  const setOnboardingCompleted = useSettingsStore(
    (s) => s.setOnboardingCompleted,
  );

  const handleGo = (): void => {
    setOnboardingDone('true');
    setOnboardingCompleted(true);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <SafeAreaView className="flex-1 items-center justify-center px-6 bg-background dark:bg-background-dark">
      <EkweWordmark size={48} />

      <Text className="font-bodyMed text-2xl text-center mt-5 text-black dark:text-white">
        Ekwe is ready.
      </Text>

      <Text className="font-body text-base text-center mt-3 text-zinc-500 dark:text-zinc-400">
        Your first translation is one tap away.
      </Text>

      <View className="w-full mt-8">
        <EkweButton
          variant="primary"
          size="large"
          label="Go to Ekwe"
          onPress={handleGo}
        />
      </View>
    </SafeAreaView>
  );
};
