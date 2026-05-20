import * as Haptics from 'expo-haptics';
import { Zap, CheckCircle2 } from 'lucide-react-native';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ResultDisplay } from './ResultDisplay';

import { AnimatedCopyButton } from '@/components';
import { Badge } from '@/components/ui';
import { useTheme } from '@/hooks';
import { EchoStep } from '@/types/echo';

interface EchoFinalResultProps {
  transcription: string | null;
  translation: string | null;
  sourceLang: string | null;
  targetLang: string;
  audioDuration?: number;
  isDark: boolean;
  setStep: (step: EchoStep) => void;
  handleClose: () => void;
}

export const EchoFinalResult: React.FC<EchoFinalResultProps> = React.memo(
  ({
    transcription,
    translation,
    sourceLang,
    targetLang,
    isDark,
    setStep,
    handleClose,
  }) => {
    const { color } = useTheme();
    const brandPrimary = color.secondary;
    const handleHex = color.border;
    const textPrimary = color.primary;

    const [activeTab, setActiveTab] = React.useState<
      'Translation' | 'Transcription'
    >('Translation');

    const handleTabChange = React.useCallback(
      (tab: 'Translation' | 'Transcription') => {
        setActiveTab(tab);
      },
      [],
    );

    return (
      <>
        <ResultDisplay
          transcription={transcription}
          translation={translation}
          defaultTab="Translation"
          onTabChange={handleTabChange}
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
          <Badge
            label="Echo Processed"
            variant="primary"
            icon={<CheckCircle2 size={12} color={brandPrimary} />}
          />
          {sourceLang && targetLang && (
            <Badge
              label={`${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}`}
              variant="primary"
            />
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
              activeTab === 'Translation' ? translation! : transcription!
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
  secActionTxt: {
    fontFamily: 'Outfit-Bold',
    fontSize: 15,
    letterSpacing: -0.2,
  },
});
