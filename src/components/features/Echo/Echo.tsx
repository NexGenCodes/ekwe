import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSelector } from '@legendapp/state/react';
import { X, AlertCircle, RefreshCw } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { EchoConfigStep } from './EchoConfig';
import { EchoFinalResult } from './EchoFinalResult';
import { EchoLanguagePicker } from './EchoLanguagePicker';
import { EchoTranslationConfig } from './EchoTranslationConfig';

import { Badge, IconContainer, SkeletonBox } from '@/components/ui';
import { STEP_METADATA } from '@/constants/echo';
import { fonts } from '@/constants/fonts';
import { LANGUAGES } from '@/constants/languages';
import { useEchoFlow, useTheme, useSharedAudioPlayer } from '@/hooks';
import { initAuth } from '@/services/auth';
import { auth$ } from '@/store';
import { EchoProps, EchoStep } from '@/types/echo';
import { formatSourceApp } from '@/utils';

/**
 * Echo — Share Extension Root Orchestrator
 *
 * This is the top-level feature component registered by index.js
 * as the `share-extension` entry point. It receives shared audio
 * data from iOS/Android, wires up the `useEchoFlow` state machine,
 * and renders step-based content inside a BottomSheet.
 */
export const Echo = (props: EchoProps): React.ReactElement => {
  useEffect(() => {
    initAuth();
  }, []);

  const userSession = useSelector(() => auth$.session.get());

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
    audioUri,
    sourceApp,
    isResolving,
    handleTranscribe,
    handleTranslate,
    audioDuration,
    error,
    onDismiss,
  } = useEchoFlow(props);

  const { color, isDark } = useTheme();

  // Preload audio as soon as audioUri is available (e.g. during PickLanguage step)
  const player = useSharedAudioPlayer(audioUri || null);

  const bottomSheetRef = useRef<BottomSheet>(null);

  // Refined snap points: 40% (Config), 75% (Standard), 90% (Deep Read)
  const snapPoints = useMemo(() => ['45%', '75%', '80%', '95%'], []);

  // Compute available target languages (default-selected only, exclude detected source)
  const availableTargetList = useMemo(
    () => LANGUAGES.filter((l) => l.defaultSelected && l.code !== detectedLang),
    [detectedLang],
  );

  const selectedLangName = useMemo(
    () =>
      selectedLang === 'auto'
        ? 'Auto-Detect'
        : LANGUAGES.find((l) => l.code === selectedLang)?.englishName ||
          selectedLang,
    [selectedLang],
  );

  const handleClose = useCallback((): void => {
    player.cleanup();
    bottomSheetRef.current?.close();
    onDismiss();
  }, [onDismiss, player]);

  const sheetIndex = useMemo(() => {
    switch (step) {
      case 'PickLanguage':
        return 1; // 95%
      case 'TranscribeResult':
        return 3; // 75%
      case 'FullResult':
        return 3; // 80%
      case 'Config':
        return 1; // 75%
      case 'Transcribing':
        return 0; // 45%
      case 'Translating':
        return 0;
      case 'Error':
      default:
        return 0; // 45%
    }
  }, [step]);

  const handleLanguageSelected = useCallback(
    (code: string): void => {
      setSelectedLang(code);
      setStep('Config');
    },
    [setSelectedLang, setStep],
  );

  // ── Step-based content renderer ──────────────────────────────────────
  const renderStepContent = (currentStep: EchoStep): React.ReactElement => {
    if (!userSession) {
      return (
        <View style={[styles.loadingContainer, { paddingVertical: 48 }]}>
          <AlertCircle
            size={48}
            color={color.error}
            style={{ marginBottom: 16 }}
          />
          <Text
            style={[
              styles.loadingTitle,
              { color: color.foreground, textAlign: 'center' },
            ]}
          >
            Login Required
          </Text>
          <Text
            style={[
              styles.loadingSubtitle,
              { color: color.muted, textAlign: 'center', marginTop: 8 },
            ]}
          >
            Please open the Ekwe app and log in to translate shared files.
          </Text>
        </View>
      );
    }

    switch (currentStep) {
      case 'PickLanguage':
        return (
          <EchoLanguagePicker
            selectedLang={selectedLang}
            onSelect={handleLanguageSelected}
          />
        );

      case 'Config':
        return (
          <EchoConfigStep
            player={player}
            isResolving={isResolving}
            isDark={isDark}
            onTranscribe={handleTranscribe}
          >
            <View
              style={[styles.metaRow, { borderTopColor: color.background }]}
            >
              <Text style={[styles.metaLabel, { color: color.muted }]}>
                {selectedLang === 'auto' ? 'Language: ' : 'Source Language: '}
              </Text>
              <Text style={[styles.metaValue, { color: color.secondary }]}>
                {selectedLangName}
              </Text>
              <TouchableOpacity
                onPress={() => setStep('PickLanguage')}
                style={[
                  styles.changeBtn,
                  {
                    backgroundColor: color.card,
                    borderColor: color.border,
                    borderWidth: 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Change language"
              >
                <Text style={[styles.changeLabel, { color: color.primary }]}>
                  Change
                </Text>
              </TouchableOpacity>
            </View>
          </EchoConfigStep>
        );

      case 'Transcribing':
        return (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingTitle, { color: color.foreground }]}>
              {STEP_METADATA.Transcribing.title}
            </Text>
            <Text style={[styles.loadingSubtitle, { color: color.muted }]}>
              Processing your audio...
            </Text>
            <View
              style={{
                width: '100%',
                gap: 12,
                marginTop: 24,
                paddingHorizontal: 16,
              }}
            >
              <SkeletonBox width="100%" height={12} borderRadius={6} />
              <SkeletonBox width="85%" height={12} borderRadius={6} />
              <SkeletonBox width="70%" height={12} borderRadius={6} />
              <SkeletonBox width="90%" height={12} borderRadius={6} />
              <View style={{ height: 4 }} />
              <SkeletonBox width="60%" height={12} borderRadius={6} />
              <SkeletonBox width="45%" height={12} borderRadius={6} />
            </View>
          </View>
        );

      case 'TranscribeResult':
        return (
          <EchoTranslationConfig
            step={currentStep}
            selectedLang={selectedLang}
            detectedLang={detectedLang}
            targetLang={targetLang}
            transcription={transcription}
            availableTargetList={availableTargetList}
            isDark={isDark}
            setTargetLang={setTargetLang}
            handleTranslate={handleTranslate}
          />
        );

      case 'Translating':
        return (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingTitle, { color: color.foreground }]}>
              Echo is translating...
            </Text>
            <Text style={[styles.loadingSubtitle, { color: color.muted }]}>
              Please wait while we process the translation.
            </Text>
            <View
              style={{
                width: '100%',
                gap: 12,
                marginTop: 24,
                paddingHorizontal: 16,
              }}
            >
              <SkeletonBox width="100%" height={12} borderRadius={6} />
              <SkeletonBox width="75%" height={12} borderRadius={6} />
              <SkeletonBox width="90%" height={12} borderRadius={6} />
              <SkeletonBox width="60%" height={12} borderRadius={6} />
            </View>
          </View>
        );

      case 'FullResult':
        return (
          <EchoFinalResult
            transcription={transcription}
            translation={translation}
            sourceLang={detectedLang}
            targetLang={targetLang}
            audioDuration={audioDuration}
            isDark={isDark}
            setStep={setStep}
            handleClose={handleClose}
          />
        );
      case 'Error':
        return (
          <View style={styles.errorContainer}>
            <View
              style={[
                styles.errorIconWrapper,
                { backgroundColor: `${color.error}15` },
              ]}
            >
              <AlertCircle size={32} color={color.error} />
            </View>
            <Text style={[styles.errorTitle, { color: color.foreground }]}>
              {error || 'An unexpected error occurred'}
            </Text>
            <Text style={[styles.errorSubtitle, { color: color.muted }]}>
              Please check your connection and try again.
            </Text>
            <TouchableOpacity
              onPress={() => setStep('PickLanguage')}
              style={[styles.retryBtn, { backgroundColor: color.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Start over"
            >
              <RefreshCw size={16} color="#FFF" />
              <Text style={styles.retryBtnText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        );
      default:
        return <View />;
    }
  };

  const isProcessing = step === 'Transcribing' || step === 'Translating';

  const stepMeta = STEP_METADATA[step];

  return (
    <View style={styles.backdrop}>
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={sheetIndex}
        enablePanDownToClose={!isProcessing}
        enableHandlePanningGesture={!isProcessing}
        enableContentPanningGesture={!isProcessing}
        onClose={onDismiss}
        backgroundStyle={[
          styles.sheetBackground,
          { backgroundColor: color.background },
        ]}
        handleIndicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: color.border },
        ]}
      >
        <BottomSheetView key={step} style={styles.sheetContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerBadgeRow}>
              <View
                style={[styles.badge, { backgroundColor: color.primary }]}
              />
              <Text style={[styles.sourceLabel, { color: color.muted }]}>
                ECHO
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Close Echo"
            >
              <IconContainer size="sm" variant="muted">
                <X size={16} color={color.foreground} />
              </IconContainer>
            </TouchableOpacity>

            {stepMeta.showBadge && (
              <View style={[StyleSheet.absoluteFill, styles.headerCenter]}>
                <Badge label={formatSourceApp(sourceApp)} variant="primary" />
              </View>
            )}
          </View>

          {/* Step Content */}
          {renderStepContent(step)}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetBackground: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12, // Notch safety margin
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  headerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  headerBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 8, height: 8, borderRadius: 4 },
  sourceLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    marginTop: 8,
  },
  metaLabel: { fontFamily: fonts.bodyMed, fontSize: 15 },
  metaValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    flex: 1,
    marginLeft: 6,
  },
  changeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  changeLabel: { fontFamily: fonts.bodyBold, fontSize: 13 },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    marginTop: 24,
    letterSpacing: -0.5,
  },
  loadingSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    marginTop: 6,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  errorIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  errorSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 8,
  },
  retryBtnText: {
    color: '#FFF',
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
});
