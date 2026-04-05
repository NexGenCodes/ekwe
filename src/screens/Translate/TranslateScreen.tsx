import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
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
import { EkweButton } from 'src/components/common/EkweButton';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { getColor } from 'src/constants/colors';
import { LANGUAGES, FLAG_MAP } from 'src/constants/languages';
import { RootStackParams } from 'src/navigation/types';
import { TranslationService } from 'src/services/Translation';
import { useHistoryStore, useSettingsStore } from 'src/store';

type Props = NativeStackScreenProps<RootStackParams, 'Translate'>;

const getLanguageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

export const TranslateScreen = ({
  route,
  navigation,
}: Props): React.JSX.Element => {
  const { text, detectedLang = 'und' } = route.params;

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
    detectedLang !== 'und' ? detectedLang : 'en',
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
    // LanguagePickerSheet allows multiple selection by default if we pass an array,
    // but we only want single selection for source/target.
    // The selection callback returns the new array of selected languages.
    // We just take the last one added, which should be the most recent tap.
    if (selectedCodes.length > 0) {
      const selected = selectedCodes[selectedCodes.length - 1];
      if (pickerMode === 'source') {
        setSourceLang(selected);
        // Clear translation if source changes
        setTranslation(null);
      } else {
        setTargetLang(selected);
        // Clear translation if target changes
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
        text,
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
          transcript: text,
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
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      {/* Header */}
      <View className="px-6 py-4 flex-row justify-between items-center bg-background border-b border-border shadow-soft">
        <Text className="font-display text-xl text-foreground">
          Translate Text
        </Text>
        <EkweButton
          variant="ghost"
          size="small"
          label="Close"
          onPress={() => navigation.goBack()}
        />
      </View>

      <ScrollView
        className="flex-1 px-6"
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
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted mr-1">
                  {detectedLang !== 'und' && sourceLang === detectedLang
                    ? 'DETECTED · '
                    : 'SOURCE · '}
                  {getLanguageName(sourceLang)} {FLAG_MAP[sourceLang] || ''}
                </Text>
                <ChevronDown size={14} color={mutedColor} />
              </Pressable>
            </View>
            <View className="bg-card p-6 rounded-3xl border border-border">
              <Text className="font-body text-lg leading-7 text-foreground">
                {text}
              </Text>
            </View>
          </View>

          {/* Divider & Target Language Selector */}
          <View className="flex-row items-center justify-between mt-2 mb-6 px-2">
            <Pressable
              onPress={handleSwap}
              className="p-3 rounded-full bg-card border border-border active:scale-95"
            >
              <ArrowDownUp size={20} color={mutedColor} />
            </Pressable>

            <View className="flex-1 h-[1px] bg-border mx-4" />

            <Pressable
              onPress={() => openPicker('target')}
              className="flex-row items-center bg-card border border-border px-4 py-3 rounded-full active:scale-95"
            >
              <Text className="font-bodyMed text-base text-foreground mr-2">
                {getLanguageName(targetLang)} {FLAG_MAP[targetLang] || ''}
              </Text>
              <ChevronDown size={16} color={mutedColor} />
            </Pressable>
          </View>

          {/* Translation Result or Translate Button */}
          {translation ? (
            <View className="mt-2 mb-8">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="font-bodyMed text-xs uppercase tracking-widest text-primary">
                  TRANSLATED · {getLanguageName(targetLang)}
                </Text>
              </View>
              <View className="bg-primary/5 p-6 rounded-3xl border border-primary/20">
                <Text className="font-body text-lg leading-7 text-foreground">
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
        <View className="px-6 py-8 border-t border-border bg-background shadow-soft">
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
};
