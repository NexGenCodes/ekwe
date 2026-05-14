import { useSelector } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ArrowDownUp } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguagePickerSheet } from '@/components';
import { Button, Card, ScreenHeader } from '@/components/ui';
import { getLanguageName, FLAG_MAP } from '@/constants/languages';
import { useTranslation, useClipboard, useTheme } from '@/hooks';
import { historyActions, settings$, settingsActions } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function TranslateScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const router = useRouter();
  const { text, detectedLang = 'und' } = params;

  // Store & Settings
  const { addEntry } = historyActions;
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const pinnedLanguages = useSelector(() => settings$.pinnedLanguages.get());
  const { setPinnedLanguages } = settingsActions;

  const { isDark, color } = useTheme();
  const primaryColor = color.primary;
  const mutedColor = color.muted;
  const { copied, copy } = useClipboard();
  const { mutateAsync: translate } = useTranslation();

  // Local State
  const [sourceLang, setSourceLang] = useState<string>(
    (detectedLang as string) !== 'und' ? (detectedLang as string) : 'en',
  );
  const [targetLang, setTargetLang] = useState<string>(
    defaultTargetLang || 'es',
  );

  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // Language Picker State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'source' | 'target'>('source');

  const openPicker = (mode: 'source' | 'target'): void => {
    setPickerMode(mode);
    setPickerVisible(true);
  };

  const handleLanguageSelect = (
    selectedCodes: string[],
    newPinned: string[],
  ): void => {
    if (selectedCodes.length > 0) {
      const selected = selectedCodes[selectedCodes.length - 1];
      if (pickerMode === 'source') {
        setSourceLang(selected);
        setTranslation(null);
      } else {
        setTargetLang(selected);
        setTranslation(null);
      }
    }
    setPinnedLanguages(newPinned);
    setPickerVisible(false);
  };

  const handleTranslate = async (): Promise<void> => {
    if (!text) return;
    setIsTranslating(true);
    try {
      const result = await translate({
        text: text as string,
        sourceLang,
        targetLang,
      });
      setTranslation(result.translation);

      // Save to history
      addEntry({
        id: `tex_${Date.now()}`,
        sourceLang,
        targetLang,
        transcript: text as string,
        translation: result.translation,
        timestamp: Date.now(),
        duration: 0,
        sourceApp: 'shared-text',
      });
    } catch {
      AppAlert.error('Translation Failed', 'Try again in a moment.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async (copyText: string): Promise<void> => {
    await copy(copyText);
  };

  const handleSwap = (): void => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setTranslation(null);
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      {/* Header */}
      <ScreenHeader title="Translate" />

      <ScrollView
        className="flex-1 px-6 bg-background dark:bg-background-dark"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="mt-8">
          {/* Source Text Context */}
          <View className="mb-4">
            <View className="flex-row justify-between items-center mb-3">
              <Pressable
                onPress={() => openPicker('source')}
                className="flex-row items-center active:opacity-60"
              >
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted dark:text-muted-dark mr-1">
                  {(detectedLang as string) !== 'und' &&
                  sourceLang === (detectedLang as string)
                    ? 'DETECTED · '
                    : 'SOURCE · '}
                  {getLanguageName(sourceLang)} {FLAG_MAP[sourceLang] || ''}
                </Text>
                <ChevronDown size={14} color={mutedColor} />
              </Pressable>
            </View>
            <Card style={{ padding: 24, borderRadius: 20 }}>
              <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                {text}
              </Text>
            </Card>
          </View>

          {/* Divider & Target Language Selector */}
          <View className="flex-row items-center justify-between mt-2 mb-6 px-2">
            <Pressable
              onPress={handleSwap}
              className="p-3 rounded-full bg-card dark:bg-card-dark border border-border dark:border-border-dark active:scale-95"
            >
              <ArrowDownUp size={20} color={mutedColor} />
            </Pressable>

            <View className="flex-1 h-[1px] bg-border dark:bg-border-dark mx-4" />

            <Pressable
              onPress={() => openPicker('target')}
              className="flex-row items-center bg-card dark:bg-card-dark border border-border dark:border-border-dark px-4 py-3 rounded-full active:scale-95"
            >
              <Text className="font-bodyMed text-base text-foreground dark:text-foreground-dark mr-2">
                {getLanguageName(targetLang)} {FLAG_MAP[targetLang] || ''}
              </Text>
              <ChevronDown size={16} color={mutedColor} />
            </Pressable>
          </View>

          {/* Translation Result or Translate Button */}
          {translation ? (
            <View className="mt-2 mb-8">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-primary dark:text-primary-dark">
                  TRANSLATED · {getLanguageName(targetLang)}
                </Text>
              </View>
              <Card variant="accent" style={{ padding: 24, borderRadius: 20 }}>
                <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                  {translation}
                </Text>
              </Card>
            </View>
          ) : (
            <View className="items-center py-6 mt-4">
              {isTranslating ? (
                <ActivityIndicator size="large" color={primaryColor} />
              ) : (
                <Button
                  variant="primary"
                  size="large"
                  label={`Translate to ${getLanguageName(targetLang)}`}
                  onPress={handleTranslate}
                  className="w-full max-w-[280px]"
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Global Action Bar */}
      {!isTranslating && translation && (
        <View className="px-6 py-8 border-t border-border dark:border-border-dark bg-background dark:bg-background-dark">
          <Button
            variant="secondary"
            size="large"
            label={copied ? 'Copied' : 'Copy Full Translation'}
            onPress={() => handleCopy(`${text}\n\n---\n\n${translation}`)}
          />
        </View>
      )}

      {/* Reusable Language Picker */}
      <LanguagePickerSheet
        isVisible={pickerVisible}
        selectedLanguages={
          pickerMode === 'source' ? [sourceLang] : [targetLang]
        }
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={handleLanguageSelect}
        onClose={() => setPickerVisible(false)}
      />
    </SafeAreaView>
  );
}
