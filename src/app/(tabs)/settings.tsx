import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguagePickerSheet, ThemeSelector } from '@/components';
import { getColor } from '@/constants/colors';
import { useForegroundApp } from '@/hooks/useForegroundApp';
import { useSettingsStore } from '@/store';

export default function SettingsScreen(): React.JSX.Element {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  const {
    themePreference,
    autoCopy,
    hapticsEnabled,
    setAutoCopy,
    setHapticsEnabled,
    selectedLanguages,
    pinnedLanguages,
    setSelectedLanguages,
    setPinnedLanguages,
  } = useSettingsStore();

  const { hasPermission, requestPermission, checkPermission } =
    useForegroundApp();

  const renderSectionHeader = (title: string): React.JSX.Element => (
    <Text className="font-bodyMed text-xs uppercase tracking-widest px-6 pt-8 pb-2 text-muted dark:text-muted-dark">
      {title}
    </Text>
  );

  const renderItem = (
    label: string,
    value: React.ReactNode,
    onPress?: () => void,
  ): React.JSX.Element => (
    <Pressable
      onPress={() => {
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={!onPress}
      className={`flex-row items-center justify-between px-4 py-4 border-b bg-card dark:bg-card-dark border-border dark:border-border-dark ${onPress ? 'active:scale-95 transition-transform duration-200' : ''}`}
    >
      <Text className="font-body text-base text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {value}
    </Pressable>
  );

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-4 py-4">
        <Text className="font-bodyMed text-2xl text-foreground dark:text-foreground-dark">
          Settings
        </Text>
      </View>

      <ScrollView className="flex-1 bg-background dark:bg-background-dark">
        {renderSectionHeader('Configuration')}
        <View className="overflow-hidden rounded-[20px] mx-4 border border-border dark:border-border-dark shadow-sm bg-card dark:bg-card-dark">
          {renderItem(
            'Auto-copy to Clipboard',
            <Switch
              value={autoCopy}
              onValueChange={setAutoCopy}
              trackColor={{ true: primaryColor }}
              thumbColor={getColor('onPrimary', isDark)}
            />,
          )}
          {renderItem(
            'Haptic Feedback',
            <Switch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ true: primaryColor }}
              thumbColor={getColor('onPrimary', isDark)}
            />,
          )}
          {renderItem(
            'App Theme',
            <Text className="font-body text-base text-muted dark:text-muted-dark capitalize">
              {themePreference}
            </Text>,
            () => setThemeSheetVisible(true),
          )}
        </View>

        {renderSectionHeader('Smart Features (Pro)')}
        <View className="overflow-hidden rounded-[20px] mx-4 border border-border dark:border-border-dark shadow-sm bg-card dark:bg-card-dark">
          {renderItem(
            'App-Context Awareness',
            <Switch
              value={!!hasPermission}
              onValueChange={async (value) => {
                if (value) {
                  router.push('/accessibility-disclosure');
                }
              }}
              trackColor={{ true: primaryColor }}
              thumbColor={getColor('onPrimary', isDark)}
            />,
          )}
          <View className="px-4 py-3 bg-muted/5">
            <Text className="font-body text-[11px] text-muted dark:text-muted-dark leading-4">
              Uses a battery-efficient Accessibility Service to detect when you
              open messaging or dating apps.
            </Text>
          </View>
        </View>

        {renderSectionHeader('Languages')}
        <View className="overflow-hidden rounded-[20px] mx-4 border border-border dark:border-border-dark shadow-sm bg-card dark:bg-card-dark">
          {renderItem(
            'Edit Selection',
            <Text className="font-body text-base text-muted dark:text-muted-dark">
              {selectedLanguages.length} active
            </Text>,
            () => setSheetVisible(true),
          )}
        </View>

        {renderSectionHeader('About')}
        <View className="overflow-hidden rounded-[20px] mx-4 border border-border dark:border-border-dark shadow-sm mb-10 bg-card dark:bg-card-dark">
          {renderItem(
            'Version',
            <Text className="font-body text-base text-muted dark:text-muted-dark">
              1.0.0
            </Text>,
          )}
          {renderItem('Privacy Policy', null, () => {})}
          <View className="p-4 items-center bg-transparent mt-4">
            <Text className="font-body text-xs tracking-wide text-center text-muted dark:text-muted-dark">
              Building the future of human connection.
            </Text>
          </View>
        </View>
      </ScrollView>

      <LanguagePickerSheet
        isVisible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        selectedLanguages={selectedLanguages}
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={(sel: string[], pins: string[]) => {
          setSelectedLanguages(sel);
          setPinnedLanguages(pins);
        }}
      />
      <ThemeSelector
        isVisible={themeSheetVisible}
        onClose={() => setThemeSheetVisible(false)}
      />
    </SafeAreaView>
  );
}
