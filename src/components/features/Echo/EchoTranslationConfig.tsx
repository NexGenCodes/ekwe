import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import {
  Zap,
  AlertCircle,
  ArrowRight,
  Ear,
  Languages,
} from 'lucide-react-native';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { AnimatedCopyButton, ScrollableTextBox } from '@/components';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';

interface EchoTranslationConfigProps {
  step: 'TranscribeResult';
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string;
  transcription: string | null;
  availableTargetList: typeof LANGUAGES;
  isDark: boolean;
  setTargetLang: (code: string) => void;
  handleTranslate: () => void;
}

export const EchoTranslationConfig: React.FC<EchoTranslationConfigProps> =
  React.memo(
    ({
      step,
      selectedLang,
      detectedLang,
      targetLang,
      transcription,
      availableTargetList,
      setTargetLang,
      handleTranslate,
    }) => {
      const { color } = useTheme();
      const bgHex = color.card;
      const handleHex = color.border;
      const textPrimary = color.foreground;
      const textSecondary = color.muted;
      const brandPrimary = color.primary;
      const brandWarning = color.warning;

      const isMismatch =
        selectedLang !== 'auto' && selectedLang !== detectedLang;

      const selectedName =
        selectedLang === 'auto'
          ? 'Auto'
          : (LANGUAGES.find((l) => l.code === selectedLang)?.englishName ??
            selectedLang);
      const detectedName =
        LANGUAGES.find((l) => l.code === detectedLang)?.englishName ??
        detectedLang ??
        '—';
      const selectedFlag = FLAG_MAP[selectedLang] || '🌐';
      const detectedFlag = detectedLang ? FLAG_MAP[detectedLang] || '🌐' : '🌐';

      return (
        <View>
          {/* Language Pills */}
          <View style={styles.langSection}>
            {isMismatch && (
              <View
                style={[
                  styles.mismatchBadge,
                  {
                    backgroundColor: `${brandWarning}15`,
                    borderColor: `${brandWarning}30`,
                  },
                ]}
              >
                <AlertCircle size={12} color={brandWarning} />
                <Text style={[styles.mismatchText, { color: brandWarning }]}>
                  Language mismatch
                </Text>
              </View>
            )}

            <View style={styles.pillRow}>
              {/* Selected pill */}
              <View
                style={[
                  styles.langPill,
                  {
                    backgroundColor: isMismatch
                      ? `${brandWarning}10`
                      : `${brandPrimary}10`,
                    borderColor: isMismatch
                      ? `${brandWarning}25`
                      : `${brandPrimary}20`,
                  },
                ]}
              >
                <Languages
                  size={13}
                  color={isMismatch ? brandWarning : brandPrimary}
                />
                <Text style={styles.pillFlag}>{selectedFlag}</Text>
                <View>
                  <Text
                    style={[
                      styles.pillLabel,
                      {
                        color: isMismatch ? `${brandWarning}` : textSecondary,
                      },
                    ]}
                  >
                    Selected
                  </Text>
                  <Text
                    style={[
                      styles.pillValue,
                      { color: isMismatch ? brandWarning : textPrimary },
                    ]}
                  >
                    {selectedName}
                  </Text>
                </View>
              </View>

              <ArrowRight
                size={14}
                color={textSecondary}
                style={{ marginHorizontal: 4 }}
              />

              {/* Detected pill */}
              <View
                style={[
                  styles.langPill,
                  {
                    backgroundColor: `${brandPrimary}10`,
                    borderColor: `${brandPrimary}20`,
                  },
                ]}
              >
                <Ear size={13} color={brandPrimary} />
                <Text style={styles.pillFlag}>{detectedFlag}</Text>
                <View>
                  <Text style={[styles.pillLabel, { color: textSecondary }]}>
                    Detected
                  </Text>
                  <Text style={[styles.pillValue, { color: textPrimary }]}>
                    {detectedName}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <ScrollableTextBox
            text={transcription}
            height={280}
            variant="default"
          />

          <View>
            <Text style={[styles.targetLangTitle, { color: textPrimary }]}>
              Translate to:
            </Text>
            <BottomSheetScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
            >
              {availableTargetList.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  onPress={() => setTargetLang(lang.code)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        targetLang === lang.code ? brandPrimary : bgHex,
                      borderColor:
                        targetLang === lang.code ? brandPrimary : handleHex,
                    },
                  ]}
                >
                  <Text style={styles.chipFlag}>
                    {FLAG_MAP[lang.code] || '🌐'}
                  </Text>
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: targetLang === lang.code ? '#FFF' : textPrimary,
                      },
                    ]}
                  >
                    {lang.englishName}
                  </Text>
                </TouchableOpacity>
              ))}
            </BottomSheetScrollView>

            <View style={styles.footerActions}>
              <AnimatedCopyButton
                textToCopy={transcription!}
                size={16}
                style={[styles.secAction, { borderColor: handleHex }]}
              >
                <Text style={[styles.secActionTxt, { color: textPrimary }]}>
                  Copy
                </Text>
              </AnimatedCopyButton>
              <TouchableOpacity
                onPress={handleTranslate}
                disabled={!targetLang}
                style={[
                  styles.secAction,
                  {
                    backgroundColor: brandPrimary,
                    borderWidth: 0,
                    opacity: targetLang ? 1 : 0.5,
                  },
                ]}
              >
                <Zap size={16} color="#FFF" />
                <Text style={[styles.secActionTxt, { color: '#FFF' }]}>
                  Translate
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    },
  );

const styles = StyleSheet.create({
  langSection: {
    marginBottom: 16,
    gap: 8,
  },
  mismatchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  mismatchText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  langPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  pillFlag: {
    fontSize: 18,
  },
  pillLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  pillValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingTxt: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 24,
    marginBottom: 8,
  },
  targetLangTitle: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  chipsScroll: { marginBottom: 24 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    gap: 6,
  },
  chipFlag: { fontSize: 14 },
  chipText: { fontSize: 14, fontWeight: '600' },
  footerActions: { flexDirection: 'row', gap: 12 },
  secAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderRadius: 16,
  },
  secActionTxt: { fontWeight: '700', fontSize: 14 },
});
