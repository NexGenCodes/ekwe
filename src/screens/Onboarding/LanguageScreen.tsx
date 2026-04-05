import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { useSettingsStore } from 'src/store';

import { OnboardingParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingParamList, 'Language'>;

export const LanguageScreen = (): React.ReactElement => {
  const navigation = useNavigation<Nav>();
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="px-4 pt-4">
        <Text className="font-bodyMed text-2xl text-black dark:text-white">
          Your languages
        </Text>
        <Text className="font-body text-base mt-2 text-zinc-500 dark:text-zinc-400">
          Pick the ones you use most
        </Text>
      </View>

      {/* Inline LanguagePickerSheet — always visible */}
      <View className="flex-1">
        <LanguagePickerSheet
          isVisible
          selectedLanguages={selectedLanguages}
          pinnedLanguages={pinnedLanguages}
          onSelectionChange={(sel, pins) => {
            setSelectedLanguages(sel);
            setPinnedLanguages(pins);
          }}
          onClose={() => {}}
        />
      </View>

      <View className="px-4 pb-6">
        <EkweButton
          variant="primary"
          size="large"
          label="Continue"
          disabled={selectedLanguages.length === 0}
          onPress={() => navigation.navigate('Ready')}
        />
      </View>
    </SafeAreaView>
  );
};
