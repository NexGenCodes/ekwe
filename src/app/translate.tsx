import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ArrowDownUp } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweButton } from '@/components/common/EkweButton';
import { LanguagePickerSheet } from '@/components/common/LanguagePickerSheet';
import { getColor } from '@/constants/colors';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { TranslationService } from '@/services/Translation';
import { useHistoryStore, useSettingsStore } from '@/store';

export default function TranslateScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const router = useRouter();
  const { text, detectedLang = 'und' } = params;

  const getLanguageName = (code: string): string =>
    LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

  // Store & Settings
  const addEntry = useHistoryStore((s) => s.addEntry);
  const defaultTargetLang = useSettingsStore((s) => s.targetLanguage);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);
  const mutedColor = getColor('muted', isDark);

  // Local State
  const [sourceLang, setSourceLang] = useState<string>(
    (detectedLang as string) !== 'und' ? (detectedLang as string) : 'en',
  );
  const [targetLang, setTargetLang] = useState<string>(
    defaultTargetLang || 'es',
  );

  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);

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
      const result = await TranslationService.translate(
        text as string,
        sourceLang,
        targetLang,
      );
      if (result.ok) {
        setTranslation(result.value.translation);

        // Save to history
        addEntry({
          id: `tex_${Date.now()}`,
          sourceLang,
          targetLang,
          transcript: text as string,
          translation: result.value.translation,
          timestamp: Date.now(),
          duration: 0,
          sourceApp: 'shared-text',
        });
      } else {
        Alert.alert('Translation Failed', 'Try again in a moment.');
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async (copyText: string): Promise<void> => {
    await Clipboard.setStringAsync(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <View className="px-6 py-4 flex-row justify-between items-center bg-background dark:bg-background-dark border-b border-border dark:border-border-dark">
        <Text className="font-display text-xl text-foreground dark:text-foreground-dark">
          Translate Text
        </Text>
        <EkweButton
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
            <View className="bg-card dark:bg-card-dark p-6 rounded-[20px] border border-border dark:border-border-dark">
              <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                {text}
              </Text>
            </View>
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
              <View className="bg-primary/5 dark:bg-primary-dark/10 p-6 rounded-[20px] border border-primary/20 dark:border-primary-dark/30">
                <Text className="font-body text-lg leading-7 text-foreground dark:text-foreground-dark">
                  {translation}
                </Text>
              </View>
            </View>
          ) : (
            <View className="items-center py-6 mt-4">
              {isTranslating ? (
                <ActivityIndicator size="large" color={primaryColor} />
              ) : (
                <EkweButton
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
          <EkweButton
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
