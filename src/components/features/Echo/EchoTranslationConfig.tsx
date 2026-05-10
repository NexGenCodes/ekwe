import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Zap, AlertCircle } from 'lucide-react-native';
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { AnimatedCopyButton } from '@/components';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';

interface EchoTranslationConfigProps {
  step: 'TranscribeResult' | 'Translating';
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
      isDark,
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

      return (
        <View>
          <View style={{ alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
            {selectedLang !== 'auto' && selectedLang !== detectedLang ? (
              <View
                style={[
                  styles.warningBanner,
                  {
                    backgroundColor: `${brandWarning}15`,
                    borderColor: `${brandWarning}30`,
                  },
                ]}
              >
                <AlertCircle size={14} color={brandWarning} />
                <Text style={[styles.warningTxt, { color: brandWarning }]}>
                  Selected{' '}
                  <Text style={{ fontWeight: 'bold' }}>
                    {
                      LANGUAGES.find((l) => l.code === selectedLang)
                        ?.englishName
                    }
                  </Text>
                  , heard{' '}
                  <Text style={{ fontWeight: 'bold' }}>
                    {LANGUAGES.find((l) => l.code === detectedLang)
                      ?.englishName || detectedLang}
                  </Text>
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.infoBanner,
                  { backgroundColor: bgHex, borderColor: handleHex },
                ]}
              >
                <Text style={[styles.infoTxt, { color: textSecondary }]}>
                  Selected{' '}
                  <Text style={{ color: textPrimary, fontWeight: '800' }}>
                    {selectedLang === 'auto'
                      ? 'Auto'
                      : LANGUAGES.find((l) => l.code === selectedLang)
                          ?.englishName}
                  </Text>{' '}
                  • Detected{' '}
                  <Text style={{ color: textPrimary, fontWeight: '800' }}>
                    {LANGUAGES.find((l) => l.code === detectedLang)
                      ?.englishName || detectedLang}
                  </Text>
                </Text>
              </View>
            )}
          </View>

          <View
            style={[
              styles.transcriptContainer,
              { backgroundColor: bgHex, borderColor: handleHex },
            ]}
          >
            <BottomSheetScrollView style={{ maxHeight: 200 }}>
              <Text style={[styles.transcriptText, { color: textPrimary }]}>
                {transcription}
              </Text>
            </BottomSheetScrollView>
          </View>

          {step === 'Translating' ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={brandPrimary} />
              <Text style={[styles.loadingTxt, { color: textPrimary }]}>
                Translating to{' '}
                {LANGUAGES.find((l) => l.code === targetLang)?.englishName}...
              </Text>
            </View>
          ) : (
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
                          color:
                            targetLang === lang.code ? '#FFF' : textPrimary,
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
                  style={[
                    styles.secAction,
                    { backgroundColor: brandPrimary, borderWidth: 0 },
                  ]}
                >
                  <Zap size={16} color="#FFF" />
                  <Text style={[styles.secActionTxt, { color: '#FFF' }]}>
                    Translate
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      );
    },
  );

const styles = StyleSheet.create({
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  warningTxt: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  infoTxt: { fontSize: 13, fontWeight: '600' },
  transcriptContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    minHeight: 120,
    marginBottom: 24,
  },
  transcriptText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
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
