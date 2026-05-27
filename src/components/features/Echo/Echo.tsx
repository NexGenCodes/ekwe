import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSelector } from '@legendapp/state/react';
import { X, AlertCircle, RefreshCw } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { EchoConfigStep } from './EchoConfig';
import { EchoFinalResult } from './EchoFinalResult';
import { EchoLanguagePicker } from './EchoLanguagePicker';
import { EchoTranslationConfig } from './EchoTranslationConfig';
import { Badge } from '../../Badge';
import { IconContainer } from '../../IconContainer';
import { SkeletonBox } from '../../SkeletonBox';

import { Box, Text, Pressable } from '@/components/ui';
import { STEP_METADATA } from '@/constants/echo';
import { LANGUAGES } from '@/constants/languages';
import { borderRadius } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
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
        <Box
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: spacing['3xl'],
          }}
        >
          <AlertCircle
            size={48}
            color={color.error}
            style={{ marginBottom: spacing.md }}
          />
          <Text
            variant="heading3"
            style={{ marginTop: spacing.lg, textAlign: 'center' }}
          >
            Login Required
          </Text>
          <Text
            variant="bodySmall"
            style={{
              color: color.muted,
              textAlign: 'center',
              marginTop: spacing.sm,
            }}
          >
            Please open the Ekwe app and log in to translate shared files.
          </Text>
        </Box>
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
            <Box
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: spacing.md,
                borderTopWidth: 1,
                marginTop: spacing.sm,
                borderTopColor: color.border,
              }}
            >
              <Text variant="bodySmall" style={{ color: color.muted }}>
                {selectedLang === 'auto' ? 'Language: ' : 'Source Language: '}
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  flex: 1,
                  marginLeft: spacing.sm,
                  color: color.secondary,
                }}
              >
                {selectedLangName}
              </Text>
              <Pressable
                feedback="opacity"
                onPress={() => setStep('PickLanguage')}
                accessibilityLabel="Change language"
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: borderRadius['2xl'],
                  backgroundColor: color.secondary,
                }}
              >
                <Text variant="bodySmall" style={{ color: color.onSecondary }}>
                  Change
                </Text>
              </Pressable>
            </Box>
          </EchoConfigStep>
        );

      case 'Transcribing':
        return (
          <Box
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing['3xl'],
            }}
          >
            <Text variant="heading3" style={{ marginTop: spacing.lg }}>
              {STEP_METADATA.Transcribing.title}
            </Text>
            <Text
              variant="bodySmall"
              style={{ marginTop: spacing.sm, color: color.muted }}
            >
              Processing your audio...
            </Text>
            <Box
              style={{
                width: '100%',
                gap: spacing.md,
                marginTop: spacing.lg,
                paddingHorizontal: spacing.md,
              }}
            >
              <SkeletonBox width="100%" height={12} borderRadius={6} />
              <SkeletonBox width="85%" height={12} borderRadius={6} />
              <SkeletonBox width="70%" height={12} borderRadius={6} />
              <SkeletonBox width="90%" height={12} borderRadius={6} />
              <Box style={{ height: 4 }} />
              <SkeletonBox width="60%" height={12} borderRadius={6} />
              <SkeletonBox width="45%" height={12} borderRadius={6} />
            </Box>
          </Box>
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
          <Box
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing['3xl'],
            }}
          >
            <Text variant="heading3" style={{ marginTop: spacing.lg }}>
              Echo is translating...
            </Text>
            <Text
              variant="bodySmall"
              style={{ marginTop: spacing.sm, color: color.muted }}
            >
              Please wait while we process the translation.
            </Text>
            <Box
              style={{
                width: '100%',
                gap: spacing.md,
                marginTop: spacing.lg,
                paddingHorizontal: spacing.md,
              }}
            >
              <SkeletonBox width="100%" height={12} borderRadius={6} />
              <SkeletonBox width="75%" height={12} borderRadius={6} />
              <SkeletonBox width="90%" height={12} borderRadius={6} />
              <SkeletonBox width="60%" height={12} borderRadius={6} />
            </Box>
          </Box>
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
          <Box
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing.xl,
            }}
          >
            <Box
              style={{
                width: 64,
                height: 64,
                borderRadius: borderRadius['2xl'],
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: spacing.lg,
                backgroundColor: `${color.error}15`,
              }}
            >
              <AlertCircle size={32} color={color.error} />
            </Box>
            <Text
              variant="body"
              style={{
                textAlign: 'center',
                marginBottom: spacing.sm,
                paddingHorizontal: spacing.lg,
                color: color.foreground,
              }}
            >
              {error || 'An unexpected error occurred'}
            </Text>
            <Text
              variant="bodySmall"
              style={{
                textAlign: 'center',
                marginBottom: spacing.lg,
                color: color.muted,
              }}
            >
              Please check your connection and try again.
            </Text>
            <Pressable
              feedback="opacity"
              onPress={() => setStep('PickLanguage')}
              accessibilityLabel="Start over"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.lg,
                borderRadius: borderRadius['2xl'],
                gap: spacing.sm,
                backgroundColor: color.secondary,
              }}
            >
              <RefreshCw size={16} color={color.onSecondary} />
              <Text variant="bodySmall" style={{ color: color.onSecondary }}>
                Start Over
              </Text>
            </Pressable>
          </Box>
        );
      default:
        return <Box />;
    }
  };

  const stepMeta = STEP_METADATA[step];

  return (
    <Box style={[{ flex: 1 }, { backgroundColor: color.overlay }]}>
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={sheetIndex}
        enablePanDownToClose={false}
        enableHandlePanningGesture={false}
        enableContentPanningGesture={false}
        onClose={onDismiss}
        backgroundStyle={{
          borderTopLeftRadius: borderRadius['2xl'],
          borderTopRightRadius: borderRadius['2xl'],
          backgroundColor: color.background,
        }}
        handleIndicatorStyle={{
          width: 40,
          height: 4,
          borderRadius: 2,
          backgroundColor: color.border,
        }}
      >
        <BottomSheetView
          key={step}
          style={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing['2xl'],
            paddingTop: spacing.md,
          }}
        >
          {/* Header */}
          <Box
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.lg,
              marginTop: spacing.sm,
            }}
          >
            <Box
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: borderRadius.sm,
                  backgroundColor: color.secondary,
                }}
              />
              <Text variant="bodySmall" style={{ color: color.muted }}>
                ECHO
              </Text>
            </Box>

            <Pressable
              feedback="opacity"
              onPress={handleClose}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel="Close Echo"
            >
              <IconContainer size="sm" variant="muted">
                <X size={16} color={color.foreground} />
              </IconContainer>
            </Pressable>

            {stepMeta.showBadge && (
              <Box
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <Badge label={formatSourceApp(sourceApp)} variant="primary" />
              </Box>
            )}
          </Box>

          {/* Step Content */}
          {renderStepContent(step)}
        </BottomSheetView>
      </BottomSheet>
    </Box>
  );
};
