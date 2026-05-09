import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { X } from 'lucide-react-native';
import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  useColorScheme,
} from 'react-native';

import { EchoConfigStep } from './Echo/EchoConfig';
import { EchoFinalResult } from './Echo/EchoFinalResult';
import { EchoLanguagePicker } from './Echo/EchoLanguagePicker';
import { EchoTranslationConfig } from './Echo/EchoTranslationConfig';

import { getColor } from '@/constants/colors';
import { LANGUAGES } from '@/constants/languages';
import { useEchoFlow } from '@/hooks/useEchoFlow';
import { useSettingsStore } from '@/store';
import { EchoProps } from '@/types/echo';

export const Echo: React.FC<EchoProps> = (props) => {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const activeTabRef = useRef<'Translation' | 'Transcription'>('Translation');
  const snapPoints = useMemo(() => ['30%', '42%', '66%', '70%'], []);

  const {
    step,
    setStep,
    selectedLang,
    setSelectedLang,
    detectedLang,
    targetLang,
    setTargetLang,
    transcription,
    translation,
    sttProvider,
    llmProvider,
    audioUri,
    isResolving,
    themePreference,
    handleTranscribe,
    handleTranslate,
    onDismiss,
  } = useEchoFlow(props);

  const { selectedLanguages } = useSettingsStore();
  const availableTargetList = useMemo(() => {
    return LANGUAGES.filter((l) => selectedLanguages.includes(l.code));
  }, [selectedLanguages]);

  const colorScheme = useColorScheme();
  const isDark =
    themePreference === 'system'
      ? colorScheme === 'dark'
      : themePreference === 'dark';

  const handleHex = getColor('border', isDark);
  const textPrimary = getColor('foreground', isDark);
  const textSecondary = getColor('muted', isDark);
  const brandPrimary = getColor('primary', isDark);
  const bgMain = getColor('background', isDark);

  const handleClose = useCallback((): void => {
    bottomSheetRef.current?.close();
  }, []);

  useEffect((): (() => void) => {
    const backAction = (): boolean => {
      handleClose();
      return true;
    };
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );
    return () => backHandler.remove();
  }, [handleClose]);

  // Snap to the correct height whenever step changes
  useEffect(() => {
    const snapMap: Record<string, number> = {
      PickLanguage: 2, // 66% - Comfortable space for scrolling languages
      Config: 2, // 42% - Audio player and action button
      Transcribing: 1, // 42% - Match Config height for smooth loading state
      TranscribeResult: 3, // 70% - Maximum vertical space for Transcript box + Language Chips
      Translating: 2, // 66% - Slight squeeze during load prevents violently bouncing back to 30%
      FullResult: 3, // 70% - Result display taking up maximum area
    };
    bottomSheetRef.current?.snapToIndex(snapMap[step] ?? 2);
  }, [step]);

  const sourceLang =
    detectedLang || (selectedLang !== 'auto' ? selectedLang : null);

  const handleSheetChange = useCallback(
    (index: number): void => {
      if (index === -1) {
        onDismiss();
      }
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="none"
      />
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <BottomSheet
        ref={bottomSheetRef}
        index={2}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        enableHandlePanningGesture={false}
        enableContentPanningGesture={false}
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={[{ backgroundColor: bgMain }]}
        handleIndicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: textSecondary },
        ]}
      >
        <BottomSheetView style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerBadgeRow}>
              <View style={[styles.badge, { backgroundColor: brandPrimary }]} />
              <Text style={[styles.sourceLabel, { color: textSecondary }]}>
                Ekwe Echo
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeBtn, { backgroundColor: handleHex }]}
            >
              <X size={16} color={textPrimary} />
            </TouchableOpacity>
          </View>

          {step === 'PickLanguage' && (
            <EchoLanguagePicker
              selectedLang={selectedLang}
              isDark={isDark}
              onSelect={(code) => {
                setSelectedLang(code);
                setStep('Config');
              }}
            />
          )}

          {(step === 'Config' || step === 'Transcribing') && (
            <View>
              {step === 'Config' ? (
                <EchoConfigStep
                  audioUri={audioUri}
                  isResolving={isResolving}
                  isDark={isDark}
                  onTranscribe={handleTranscribe}
                >
                  <View style={[styles.metaRow, { borderTopColor: handleHex }]}>
                    <Text style={[styles.metaLabel, { color: textSecondary }]}>
                      {selectedLang === 'auto'
                        ? 'Language: '
                        : 'Source Language: '}
                    </Text>
                    <Text style={[styles.metaValue, { color: textPrimary }]}>
                      {selectedLang === 'auto'
                        ? 'Auto-Detect'
                        : LANGUAGES.find((l) => l.code === selectedLang)
                            ?.englishName}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setStep('PickLanguage')}
                      style={styles.changeBtn}
                    >
                      <Text
                        style={[styles.changeLabel, { color: brandPrimary }]}
                      >
                        Change
                      </Text>
                    </TouchableOpacity>
                  </View>
                </EchoConfigStep>
              ) : (
                <View style={[styles.metaRow, { borderTopColor: handleHex }]}>
                  <Text style={[styles.metaLabel, { color: textSecondary }]}>
                    {selectedLang === 'auto'
                      ? 'Language: '
                      : 'Source Language: '}
                  </Text>
                  <Text style={[styles.metaValue, { color: textPrimary }]}>
                    {selectedLang === 'auto'
                      ? 'Auto-Detect'
                      : LANGUAGES.find((l) => l.code === selectedLang)
                          ?.englishName}
                  </Text>
                </View>
              )}

              {step === 'Transcribing' && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={brandPrimary} />
                  <Text style={[styles.loadingTxt, { color: textPrimary }]}>
                    Listening carefully...
                  </Text>
                </View>
              )}
            </View>
          )}

          {(step === 'TranscribeResult' || step === 'Translating') && (
            <EchoTranslationConfig
              step={step}
              selectedLang={selectedLang}
              detectedLang={detectedLang}
              targetLang={targetLang}
              transcription={transcription}
              availableTargetList={availableTargetList}
              isDark={isDark}
              setTargetLang={setTargetLang}
              handleTranslate={handleTranslate}
            />
          )}

          {step === 'FullResult' && (
            <EchoFinalResult
              transcription={transcription}
              translation={translation}
              sttProvider={sttProvider}
              llmProvider={llmProvider}
              sourceLang={sourceLang}
              targetLang={targetLang}
              isDark={isDark}
              activeTabRef={activeTabRef}
              setStep={setStep}
              handleClose={handleClose}
            />
          )}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  handleIndicator: { width: 40, height: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  headerBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 8, height: 8, borderRadius: 4 },
  sourceLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
    marginBottom: 20,
  },
  metaLabel: { fontSize: 12, fontWeight: '600' },
  metaValue: { fontSize: 12, fontWeight: '800' },
  changeBtn: { marginLeft: 'auto' },
  changeLabel: { fontSize: 12, fontWeight: '700' },
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
});
