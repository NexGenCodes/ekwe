import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Zap, Copy, CheckCircle2 } from 'lucide-react-native';
import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  useColorScheme,
} from 'react-native';

import {
  LanguageGrid,
  PlaybackControl,
  ResultDisplay,
} from '@/components/common';
import { getColor } from '@/constants/colors';
import { STEP_METADATA } from '@/constants/echo';
import { LANGUAGES } from '@/constants/languages';
import { useEchoFlow } from '@/hooks/useEchoFlow';
import { EchoProps } from '@/types/echo';

export const Echo: React.FC<EchoProps> = (props) => {
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Use Modular Business Logic
  const {
    step,
    setStep,
    selectedLang,
    setSelectedLang,
    transcription,
    translation,
    activeTab,
    setActiveTab,
    sourceApp,
    player,
    isResolving,
    themePreference,
    handleProcess,
    handleCopy,
    onDismiss,
  } = useEchoFlow(props);

  const colorScheme = useColorScheme();
  const isDark =
    themePreference === 'system'
      ? colorScheme === 'dark'
      : themePreference === 'dark';

  const bgHex = getColor('card', isDark);
  const handleHex = getColor('border', isDark);
  const textPrimary = getColor('foreground', isDark);
  const textSecondary = getColor('muted', isDark);
  const brandPrimary = getColor('primary', isDark);
  const bgMain = getColor('background', isDark);

  const handleClose = useCallback((): void => {
    bottomSheetRef.current?.close();
  }, []);

  // Pro-Level: Handle Android physical back button correctly
  useEffect((): (() => void) => {
    const backAction = (): boolean => {
      handleClose();
      return true; // prevent default behavior
    };
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );
    return () => backHandler.remove();
  }, [handleClose]);

  const onSheetChange = useCallback(
    (index: number): void => {
      if (index === -1) {
        onDismiss();
      }
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (
      backdropProps: React.JSX.IntrinsicAttributes &
        import('@gorhom/bottom-sheet').BottomSheetBackdropProps,
    ): React.JSX.Element => (
      <BottomSheetBackdrop
        {...backdropProps}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <BottomSheet
        ref={bottomSheetRef}
        enableDynamicSizing
        enablePanDownToClose={false}
        enableContentPanningGesture={false}
        enableHandlePanningGesture={false}
        onChange={onSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={[{ backgroundColor: bgHex }]}
        handleIndicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: handleHex },
        ]}
      >
        <BottomSheetView style={styles.content}>
          {/* Header Block */}
          <View style={styles.header}>
            <View style={styles.headerBadgeRow}>
              {STEP_METADATA[step].showBadge && (
                <View
                  style={[styles.badge, { backgroundColor: brandPrimary }]}
                />
              )}
              <Text style={[styles.sourceLabel, { color: textPrimary }]}>
                {STEP_METADATA[step].title === 'Magic Results'
                  ? '✨ Echo Magic'
                  : `${sourceApp} Audio`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeBtn, { backgroundColor: bgMain }]}
            >
              <Text style={[styles.closeBtnTxt, { color: textSecondary }]}>
                ✕
              </Text>
            </TouchableOpacity>
          </View>

          {/* Phase 1: Language Selection */}
          {step === 'PickLanguage' && (
            <View>
              <Text style={[styles.stepTitle, { color: textPrimary }]}>
                {STEP_METADATA.PickLanguage.title}
              </Text>
              <LanguageGrid
                selectedLang={selectedLang}
                onSelect={(code) => {
                  setSelectedLang(code);
                  setStep('Config');
                }}
                isDark={isDark}
              />
            </View>
          )}

          {/* Phase 2: Preview & Configuration */}
          {(step === 'Config' || step === 'Processing') && (
            <View>
              <PlaybackControl
                isPlaying={player.isPlaying}
                isDecoding={player.isDecoding}
                progress={player.progress}
                duration={player.duration}
                peaks={player.realWaveform}
                onTogglePlay={() =>
                  player.isPlaying ? player.pause() : player.play()
                }
                onSeek={player.seek}
                isDark={isDark}
              />

              {/* Status Indicator */}
              <View style={[styles.metaRow, { borderTopColor: handleHex }]}>
                <Text style={[styles.metaLabel, { color: textSecondary }]}>
                  Detected as:{' '}
                </Text>
                <Text style={[styles.metaValue, { color: textPrimary }]}>
                  {selectedLang === 'auto'
                    ? 'Waiting for magic...'
                    : LANGUAGES.find((l) => l.code === selectedLang)
                        ?.englishName}
                </Text>
                {step === 'Config' && (
                  <TouchableOpacity
                    onPress={() => setStep('PickLanguage')}
                    style={styles.changeBtn}
                  >
                    <Text style={[styles.changeLabel, { color: brandPrimary }]}>
                      Change
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {step === 'Config' && (
                <TouchableOpacity
                  onPress={handleProcess}
                  disabled={!player.isLoaded || isResolving}
                  style={[
                    styles.primaryAction,
                    {
                      backgroundColor: brandPrimary,
                      opacity: player.isLoaded && !isResolving ? 1 : 0.6,
                    },
                  ]}
                >
                  {(!player.isLoaded || isResolving) && (
                    <ActivityIndicator
                      size="small"
                      color="#FFF"
                      style={{ marginRight: 8 }}
                    />
                  )}
                  <Zap size={18} color="#FFF" fill="#FFF" />
                  <Text style={styles.primaryActionTxt}>
                    {isResolving
                      ? 'Preparing Audio...'
                      : player.isLoaded
                        ? 'Start Translation'
                        : 'Decoding Audio...'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Phase 2: Processing Overlay */}
              {step === 'Processing' && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={brandPrimary} />
                  <Text style={[styles.loadingTxt, { color: textPrimary }]}>
                    Casting Echo Magic...
                  </Text>
                  <Text
                    style={[styles.loadingSubTxt, { color: textSecondary }]}
                  >
                    Translating audio pulses into text
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Phase 3: Results Display */}
          {step === 'Result' && (
            <View>
              <ResultDisplay
                transcription={transcription}
                translation={translation}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                isDark={isDark}
              />

              <View style={styles.footerActions}>
                <TouchableOpacity
                  onPress={handleCopy}
                  style={[styles.secAction, { borderColor: handleHex }]}
                >
                  <Copy size={16} color={textPrimary} />
                  <Text style={[styles.secActionTxt, { color: textPrimary }]}>
                    Copy Result
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleClose}
                  style={[
                    styles.secAction,
                    { backgroundColor: handleHex, borderWidth: 0 },
                  ]}
                >
                  <CheckCircle2 size={16} color={textPrimary} />
                  <Text style={[styles.secActionTxt, { color: textPrimary }]}>
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  handleIndicator: { width: 40, height: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
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
  closeBtnTxt: { fontSize: 14, fontWeight: 'bold' },
  stepTitle: { fontSize: 18, fontWeight: '800', marginBottom: 20 },
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
  primaryAction: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
    borderRadius: 20,
  },
  primaryActionTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
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
  loadingSubTxt: { fontSize: 13, fontWeight: '500', opacity: 0.7 },
  footerActions: { flexDirection: 'row', gap: 12 },
  secAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
    borderRadius: 20,
    borderWidth: 1,
  },
  secActionTxt: { fontWeight: '700', fontSize: 14 },
});
