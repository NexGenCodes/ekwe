import { useSelector } from '@legendapp/state/react';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams } from 'expo-router';
import { ChevronDown, ArrowDownUp } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from 'react-native';

import { LanguagePickerSheet } from '@/components';
import { Button, Card } from '@/components/ui';
import { getLanguageName, FLAG_MAP } from '@/constants/languages';
import { useTranslation, useClipboard, useTheme } from '@/hooks';
import { HistoryService } from '@/services/HistoryService';
import { settings$, settingsActions, auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function TranslateScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const { text, detectedLang = 'und' } = params;

  // Store & Settings
  const userSession = useSelector(() => auth$.session.get());
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const pinnedLanguages = useSelector(() => settings$.pinnedLanguages.get());
  const { setPinnedLanguages } = settingsActions;

  const { color, isDark } = useTheme();
  const primaryColor = color.primary;
  const mutedColor = color.muted;
  const { copied, copy } = useClipboard();
  const { translate } = useTranslation();

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
      const result = await translate(text as string, sourceLang, targetLang);

      if (!result.ok) {
        throw new Error(result.error);
      }

      const translationText = result.value.translation;
      setTranslation(translationText);

      // Save to history via HistoryService
      await HistoryService.recordTranslation(
        {
          sourceLang,
          targetLang,
          transcript: text as string,
          translation: translationText,
          transliteration: null,
          duration: 0,
          sourceApp: 'shared-text',
          provider: 'gemini',
        },
        userSession,
      );
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

  const Container = process.env.EXPO_OS === 'ios' ? BlurView : View;
  const containerProps =
    process.env.EXPO_OS === 'ios'
      ? { intensity: 80, tint: isDark ? ('dark' as const) : ('light' as const) }
      : { style: { flex: 1, backgroundColor: color.background } };

  return (
    <Container {...containerProps} style={styles.flex1}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.mainContainer}>
          {/* Source Text Context */}
          <View style={styles.block}>
            <View style={styles.blockHeader}>
              <Pressable
                onPress={() => openPicker('source')}
                style={styles.pickerTrigger}
              >
                <Text
                  style={[styles.pickerTriggerText, { color: color.muted }]}
                >
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
              <Text style={[styles.cardText, { color: color.foreground }]}>
                {text}
              </Text>
            </Card>
          </View>

          {/* Divider & Target Language Selector */}
          <View style={styles.controlsRow}>
            <Pressable
              onPress={handleSwap}
              style={[
                styles.swapButton,
                { backgroundColor: color.card, borderColor: color.border },
              ]}
            >
              <ArrowDownUp size={20} color={mutedColor} />
            </Pressable>

            <View style={[styles.divider, { backgroundColor: color.border }]} />

            <Pressable
              onPress={() => openPicker('target')}
              style={[
                styles.targetPickerButton,
                { backgroundColor: color.card, borderColor: color.border },
              ]}
            >
              <Text
                style={[styles.targetPickerText, { color: color.foreground }]}
              >
                {getLanguageName(targetLang)} {FLAG_MAP[targetLang] || ''}
              </Text>
              <ChevronDown size={16} color={mutedColor} />
            </Pressable>
          </View>

          {/* Translation Result or Translate Button */}
          {translation ? (
            <View style={styles.resultBlock}>
              <View style={styles.blockHeader}>
                <Text style={[styles.blockLabel, { color: primaryColor }]}>
                  TRANSLATED · {getLanguageName(targetLang)}
                </Text>
              </View>
              <Card variant="accent" style={{ padding: 24, borderRadius: 20 }}>
                <Text style={[styles.cardText, { color: color.foreground }]}>
                  {translation}
                </Text>
              </Card>
            </View>
          ) : (
            <View style={styles.translateActionContainer}>
              {isTranslating ? (
                <ActivityIndicator size="large" color={primaryColor} />
              ) : (
                <Button
                  variant="primary"
                  size="large"
                  label={`Translate to ${getLanguageName(targetLang)}`}
                  onPress={handleTranslate}
                  style={styles.translateButton}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Global Action Bar */}
      {!isTranslating && translation && (
        <View
          style={[
            styles.actionBar,
            { borderTopColor: color.border, backgroundColor: color.background },
          ]}
        >
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
    </Container>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  mainContainer: { marginTop: 32 },
  block: { marginBottom: 16 },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pickerTrigger: { flexDirection: 'row', alignItems: 'center' },
  pickerTriggerText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginRight: 4,
  },
  cardText: { fontFamily: 'Outfit-Regular', fontSize: 18, lineHeight: 28 },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  swapButton: { padding: 12, borderRadius: 9999, borderWidth: 1 },
  divider: { flex: 1, height: 1, marginHorizontal: 16 },
  targetPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 9999,
    borderWidth: 1,
  },
  targetPickerText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
    marginRight: 8,
  },
  resultBlock: { marginTop: 8, marginBottom: 32 },
  blockLabel: {
    fontFamily: 'Outfit-Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  translateActionContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    marginTop: 16,
  },
  translateButton: { width: '100%', maxWidth: 280 },
  actionBar: { paddingHorizontal: 24, paddingVertical: 32, borderTopWidth: 1 },
});
