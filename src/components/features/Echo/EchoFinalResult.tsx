import * as Haptics from 'expo-haptics';
import { Zap, CheckCircle2 } from 'lucide-react-native';
import React, { MutableRefObject } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ResultDisplay } from '@/components';
import { AnimatedCopyButton } from '@/components';
import { useTheme } from '@/hooks';
import { EchoStep } from '@/types/echo';

interface EchoFinalResultProps {
  transcription: string | null;
  translation: string | null;
  sttProvider: string | undefined;
  llmProvider: string | undefined;
  sourceLang: string | null;
  targetLang: string;
  isDark: boolean;
  activeTabRef: MutableRefObject<'Translation' | 'Transcription'>;
  setStep: (step: EchoStep) => void;
  handleClose: () => void;
}

export const EchoFinalResult: React.FC<EchoFinalResultProps> = React.memo(
  ({
    transcription,
    translation,
    sttProvider,
    llmProvider,
    sourceLang,
    targetLang,
    isDark,
    activeTabRef,
    setStep,
    handleClose,
  }) => {
    const { color } = useTheme();
    const brandPrimary = color.primary;
    const handleHex = color.border;
    const textPrimary = color.foreground;

    return (
      <>
        <ResultDisplay
          transcription={transcription}
          translation={translation}
          defaultTab="Translation"
          onTabChange={(tab) => {
            activeTabRef.current = tab;
          }}
          isDark={isDark}
          sourceLang={sourceLang}
          targetLang={targetLang}
        />

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {sttProvider && (
            <View
              style={[
                styles.providerBadge,
                { backgroundColor: `${brandPrimary}15` },
              ]}
            >
              <Zap size={12} color={brandPrimary} />
              <Text style={[styles.providerTxt, { color: brandPrimary }]}>
                STT: {sttProvider.toUpperCase()}
              </Text>
            </View>
          )}
          {llmProvider && (
            <View
              style={[
                styles.providerBadge,
                { backgroundColor: `${brandPrimary}15` },
              ]}
            >
              <Zap size={12} color={brandPrimary} />
              <Text style={[styles.providerTxt, { color: brandPrimary }]}>
                LLM: {llmProvider.toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footerActions}>
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync();
              setStep('TranscribeResult');
            }}
            style={[styles.secAction, { borderColor: handleHex }]}
          >
            <Zap size={16} color={brandPrimary} />
            <Text style={[styles.secActionTxt, { color: brandPrimary }]}>
              Re-translate
            </Text>
          </TouchableOpacity>

          <AnimatedCopyButton
            textToCopy={
              activeTabRef.current === 'Translation'
                ? translation!
                : transcription!
            }
            size={16}
            style={[styles.secAction, { borderColor: handleHex }]}
          >
            <Text style={[styles.secActionTxt, { color: textPrimary }]}>
              Copy
            </Text>
          </AnimatedCopyButton>

          <TouchableOpacity
            onPress={handleClose}
            style={[
              styles.secAction,
              { backgroundColor: brandPrimary, borderWidth: 0 },
            ]}
          >
            <CheckCircle2 size={16} color="#FFF" />
            <Text style={[styles.secActionTxt, { color: '#FFF' }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  },
);

const styles = StyleSheet.create({
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  providerTxt: { fontSize: 11, fontWeight: '700' },
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
