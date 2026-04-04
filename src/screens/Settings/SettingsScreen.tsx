import * as Haptics from 'expo-haptics';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRightIcon } from 'src/assets/icons/ChevronRightIcon';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { ThemeToggler } from 'src/components/common/ThemeToggler';
import { getColor } from 'src/constants/theme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

export const SettingsScreen = ({
  navigation,
}: MainTabScreenProps<'Settings'>): React.ReactElement => {
  const [sheetVisible, setSheetVisible] = useState(false);
  const { colorScheme } = useColorScheme();

  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const targetLanguage = useSettingsStore((s) => s.targetLanguage);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setTargetLanguage = useSettingsStore((s) => s.setTargetLanguage);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  const handleLanguageChange = (sel: string[], pins: string[]): void => {
    setSelectedLanguages(sel);
    setPinnedLanguages(pins);

    // Ensure targetLanguage is still in the selected list
    if (!sel.includes(targetLanguage) && sel.length > 0) {
      setTargetLanguage(sel[0]);
    } else if (sel.length === 0) {
      setTargetLanguage('en'); // Default fallback
    }
  };

  const isDark = colorScheme === 'dark';
  const tertiaryColor = getColor('muted', isDark);

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-6 pt-4 pb-2">
          <Text className="font-display text-[32px] leading-[38px] text-zinc-950 dark:text-zinc-50">
            Settings
          </Text>
        </View>

        <View className="mt-8 px-4">
          <Text className="font-bodyMed text-xs tracking-[1px] pl-1 text-zinc-500 dark:text-zinc-400">
            APPEARANCE
          </Text>
          <View className="h-16 flex-row items-center px-4 justify-between bg-card dark:bg-card-dark rounded-xl mt-2">
            <Text className="font-body text-base text-zinc-950 dark:text-zinc-50">
              Theme
            </Text>
            <ThemeToggler />
          </View>
        </View>

        <View className="mt-8 px-4">
          <Text className="font-bodyMed text-xs tracking-[1px] pl-1 text-zinc-500 dark:text-zinc-400">
            LANGUAGES
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setSheetVisible(true);
            }}
            className="h-16 flex-row items-center px-4 justify-between bg-card dark:bg-card-dark rounded-xl mt-2 border border-zinc-200/50 dark:border-zinc-800/50 active:bg-zinc-100 dark:active:bg-zinc-800/80"
          >
            <View className="flex-1">
              <Text className="font-body text-base text-zinc-950 dark:text-zinc-50">
                Selected
              </Text>
              <Text className="font-body text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {selectedLanguages.length} active
              </Text>
            </View>
            <ChevronRightIcon size={20} color={tertiaryColor} />
          </Pressable>
        </View>

        <View className="mt-8 px-4">
          <Text className="font-bodyMed text-xs tracking-[1px] pl-1 text-zinc-500 dark:text-zinc-400">
            ABOUT
          </Text>
          <View className="bg-card dark:bg-card-dark rounded-xl mt-2 border border-zinc-200/50 dark:border-zinc-800/50 overflow-hidden">
            <View className="flex-row justify-between px-4 py-4">
              <Text className="font-body text-base text-zinc-500 dark:text-zinc-400">
                Version
              </Text>
              <Text className="font-bodyMed text-base text-zinc-950 dark:text-zinc-50 font-semibold">
                1.0.0-PRO
              </Text>
            </View>
            <View className="h-[0.5px] bg-zinc-200 dark:bg-zinc-800 mx-4" />
            <View className="flex-row justify-between px-4 py-4">
              <Text className="font-body text-base text-zinc-500 dark:text-zinc-400">
                Developer
              </Text>
              <Text className="font-bodyMed text-base text-zinc-950 dark:text-zinc-50 font-semibold">
                Ekwe Team
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <LanguagePickerSheet
        isVisible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        selectedLanguages={selectedLanguages}
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={handleLanguageChange}
      />
    </SafeAreaView>
  );
};
