import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { ThemeToggler } from 'src/components/common/ThemeToggler';
import { getColor } from 'src/constants/colors';
import { useSettingsStore } from 'src/store';

export const SettingsScreen = (): React.JSX.Element => {
  const [sheetVisible, setSheetVisible] = useState(false);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  const {
    autoCopy,
    hapticsEnabled,
    setAutoCopy,
    setHapticsEnabled,
    selectedLanguages,
    pinnedLanguages,
    setSelectedLanguages,
    setPinnedLanguages,
  } = useSettingsStore();

  const renderSectionHeader = (title: string): React.JSX.Element => (
    <Text className="font-bodyMed text-xs uppercase tracking-widest px-4 pt-8 pb-2 text-muted">
      {title}
    </Text>
  );

  const renderItem = (
    label: string,
    value: React.ReactNode,
    onPress?: () => void,
  ): React.JSX.Element => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center justify-between px-4 py-4 border-b bg-card border-border ${onPress ? 'active:opacity-70' : ''}`}
    >
      <Text className="font-body text-base text-foreground">{label}</Text>
      {value}
    </Pressable>
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <View className="px-4 py-4">
        <Text className="font-bodyMed text-2xl text-foreground">Settings</Text>
      </View>

      <ScrollView className="flex-1">
        {renderSectionHeader('Configuration')}
        <View className="overflow-hidden rounded-xl mx-2">
          {renderItem(
            'Auto-copy to Clipboard',
            <Switch
              value={autoCopy}
              onValueChange={setAutoCopy}
              trackColor={{ true: primaryColor }}
              thumbColor={isDark ? '#FFFFFF' : '#FFFFFF'}
            />,
          )}
          {renderItem(
            'Haptic Feedback',
            <Switch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ true: primaryColor }}
              thumbColor={isDark ? '#FFFFFF' : '#FFFFFF'}
            />,
          )}
          {renderItem('Theme', <ThemeToggler />)}
        </View>

        {renderSectionHeader('Languages')}
        <View className="overflow-hidden rounded-xl mx-2">
          {renderItem(
            'Edit Selection',
            <Text className="font-body text-base text-muted">
              {selectedLanguages.length} active
            </Text>,
            () => setSheetVisible(true),
          )}
        </View>

        {renderSectionHeader('About')}
        <View className="overflow-hidden rounded-xl mx-2 mb-10">
          {renderItem(
            'Version',
            <Text className="font-body text-base text-muted">1.0.0</Text>,
          )}
          {renderItem('Privacy Policy', null, () => {})}
          <View className="p-4 items-center bg-transparent mt-4">
            <Text className="font-body text-xs tracking-wide text-center text-muted">
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
    </SafeAreaView>
  );
};
