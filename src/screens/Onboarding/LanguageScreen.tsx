import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';
import { LanguagePickerInline } from 'src/components/common/LanguagePickerInline';
import { PageDots } from 'src/components/common/PageDots';
import { OnboardingScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

export const LanguageScreen = ({
  navigation,
}: OnboardingScreenProps<'Language'>): React.ReactElement => {
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const targetLanguage = useSettingsStore((s) => s.targetLanguage);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setTargetLanguage = useSettingsStore((s) => s.setTargetLanguage);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      {/* Step indicator */}
      <View className="pt-4 pb-6 items-center px-6">
        <PageDots total={3} active={2} />
      </View>

      <View className="mb-4 px-6">
        <Text className="text-[28px] leading-[34px] tracking-[-0.5px] font-display text-zinc-950 dark:text-zinc-50">
          Your languages
        </Text>
        <Text className="text-base font-body text-zinc-500 dark:text-zinc-400 mt-2">
          Pick up to 4 languages you use most
        </Text>
      </View>

      <View className="flex-1 pb-[100px]">
        <LanguagePickerInline
          selectedLanguages={selectedLanguages}
          pinnedLanguages={pinnedLanguages}
          onSelectionChange={(sel, pins) => {
            setSelectedLanguages(sel);
            setPinnedLanguages(pins);

            // Initialize targetLanguage if not set or if removed
            if (!sel.includes(targetLanguage) && sel.length > 0) {
              setTargetLanguage(sel[0]);
            }
          }}
        />
      </View>

      <View className="absolute bottom-0 w-full px-8 pb-10 bg-background/90 dark:bg-background-dark/90">
        <EkweButton
          variant="primary"
          size="large"
          label="Continue"
          disabled={selectedLanguages.length === 0}
          onPress={() => {
            navigation.navigate('AllSet');
          }}
        />
      </View>
    </SafeAreaView>
  );
};
