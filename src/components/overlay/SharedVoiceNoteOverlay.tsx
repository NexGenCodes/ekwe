import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  LucideX,
  LucideCopy,
  LucideZap,
  LucidePlay,
  LucidePause,
  LucideLoader2,
  LucideGlobe,
  LucideChevronRight,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { AudioWaveform } from '@/components/common/AudioWaveform/AudioWaveform';
import { getColor } from '@/constants/colors';
import { LANGUAGES } from '@/constants/languages';
import { useSharedAudioPlayer } from '@/hooks/useSharedAudioPlayer';
import { TranscriptionService } from '@/services/Transcription';
import { TranslationService } from '@/services/Translation';
import { useAudioStore, useSettingsStore, useHistoryStore } from '@/store';
import { OverlayStep } from '@/store/audioSlice';

const SCREEN = Dimensions.get('window');

/**
 * SharedVoiceNoteOverlay (Production Edition)
 *
 * An isolated, performance-optimized "App-in-App" for processing
 * voiced shared via intent.
 *
 * Features:
 * - Solid UI (Production standard, non-transparent)
 * - JSI-Powered universal decoding (Works for Opus on iOS)
 * - Proactive background decoding (Zero-Wait)
 * - Real Waveform visualization
 * - Full Transcription & Translation flow
 */
export const SharedVoiceNoteOverlay = (): React.ReactElement | null => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const {
    showOverlay,
    overlayStep,
    overlayFileUri,
    setOverlayState,
    setSourceLang,
    sourceLang,
    resetAudioState,
  } = useAudioStore();

  const { selectedLanguages, targetLanguage, autoCopy } = useSettingsStore();
  const { addEntry, updateEntry } = useHistoryStore();

  // Local Processing State
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);

  // Audio Player Engine (Modern JSI)
  const player = useSharedAudioPlayer(overlayFileUri);

  const primaryColor = useMemo(() => getColor('primary', isDark), [isDark]);
  const foregroundColor = useMemo(
    () => getColor('foreground', isDark),
    [isDark],
  );
  const mutedColor = useMemo(() => getColor('muted', isDark), [isDark]);
  const bgCard = isDark ? 'bg-zinc-950' : 'bg-white';

  // GESTURE STATE
  const translateY = useSharedValue(0);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.pause();
    useAudioStore.getState().setActiveFloatingHead('none'); // Clear head state
    resetAudioState();
    translateY.value = 0;
  };

  useEffect(() => {
    if (showOverlay) {
      useAudioStore.getState().setActiveFloatingHead('card');
    }
  }, [showOverlay]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 120 || event.velocityY > 500) {
        runOnJS(handleClose)();
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    if (!showOverlay) {
      setTranscription('');
      setTranslation('');
      setShowTranslation(false);
      setSavedEntryId(null);
      translateY.value = 0;
    }
  }, [showOverlay]);

  const handleSelectLang = (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSourceLang(code);
    setOverlayState(true, OverlayStep.Preview);
  };

  const handleTranscribe = async () => {
    if (!overlayFileUri) return;

    // PRE-FLIGHT: Check network before burning 45s on a doomed fetch
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      // TODO: Show inline "No connection" banner instead of this alert
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setOverlayState(true, OverlayStep.Process);

    const audioData = {
      uri: overlayFileUri,
      durationMs: player.duration * 1000,
      trimStartMs: 0,
      trimEndMs: 0,
      hasSpeech: true,
      averageDb: -20,
      meteringData: player.realWaveform,
    };

    const result = await TranscriptionService.transcribe(
      audioData,
      sourceLang || 'auto',
    );

    if (result.ok) {
      const transcript = result.value.transcript;
      const historyId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      setTranscription(transcript);
      setSavedEntryId(historyId);
      setOverlayState(true, OverlayStep.Result);

      // Auto-Save to History (Step 1: Transcription)
      addEntry({
        id: historyId,
        sourceLang: sourceLang || 'auto',
        targetLang: targetLanguage || 'en',
        transcript,
        translation: null,
        timestamp: Date.now(),
        duration: player.duration,
        sourceApp: 'Shared',
      });

      // Auto-Copy (Respecting User Settings)
      if (autoCopy) {
        Clipboard.setStringAsync(transcript);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else {
      setOverlayState(true, OverlayStep.Pick);
    }
  };

  const handleTranslate = async () => {
    if (!transcription) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsTranslating(true);

    const result = await TranslationService.translate(
      transcription,
      sourceLang || 'en',
      targetLanguage || 'en',
    );

    if (result.ok) {
      const translatedText = result.value.translation;
      setTranslation(translatedText);
      setShowTranslation(true);

      // Auto-Update History (Step 2: Add Translation)
      if (savedEntryId) {
        updateEntry(savedEntryId, { translation: translatedText });
      }
    }
    setIsTranslating(false);
  };

  const handleSeek = (percentage: number) => {
    player.seek(percentage * player.duration);
    Haptics.selectionAsync();
  };

  const handleCopy = async () => {
    const textToCopy = showTranslation ? translation : transcription;
    await Clipboard.setStringAsync(textToCopy);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (!showOverlay) return null;

  return (
    <View className="absolute inset-0 z-[100] items-center justify-end pb-8 px-4 pointer-events-auto">
      {/* Dimmed Background */}
      <View
        className="absolute inset-0 bg-black/60"
        onTouchStart={handleClose}
      />

      <GestureDetector gesture={panGesture}>
        <Animated.View
          layout={LinearTransition.springify().damping(18).stiffness(120)}
          className={`w-full overflow-hidden rounded-[32px] border border-white/5 shadow-2xl ${bgCard}`}
          style={animatedCardStyle}
        >
          <View className="p-6">
            {/* Grabber Handle */}
            <View className="items-center mb-4 -mt-2">
              <View
                className={`w-12 h-1.5 rounded-full ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`}
              />
            </View>

            {/* Header Area */}
            <View className="flex-row justify-between items-center mb-6">
              <View>
                <Text
                  className="text-[10px] font-bodyBold uppercase tracking-widest"
                  style={{ color: mutedColor }}
                >
                  {overlayStep === OverlayStep.Pick
                    ? 'Step 1: Language'
                    : 'Voice Note Insights'}
                </Text>
                {overlayStep !== OverlayStep.Pick && (
                  <View className="flex-row items-center mt-1">
                    <LucideGlobe size={13} color={primaryColor} />
                    <Text className="text-foreground font-bodyBold text-xs ml-1.5 capitalize">
                      {LANGUAGES.find((l) => l.code === sourceLang)
                        ?.englishName || sourceLang}
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={handleClose}
                className={`w-8 h-8 rounded-full ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'} items-center justify-center`}
              >
                <LucideX size={16} color={foregroundColor} />
              </TouchableOpacity>
            </View>

            <Animated.View layout={LinearTransition}>
              {overlayStep === OverlayStep.Pick && (
                <Animated.View entering={FadeIn} exiting={FadeOut}>
                  <Text className="text-foreground font-bodyMed mb-4 px-1">
                    Select the audio language:
                  </Text>
                  <View className="flex-row flex-wrap gap-2 mb-4">
                    {selectedLanguages.slice(0, 5).map((code) => (
                      <TouchableOpacity
                        key={code}
                        onPress={() => handleSelectLang(code)}
                        className={`px-4 py-2.5 rounded-xl border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'} items-center justify-center`}
                      >
                        <Text className="text-foreground font-bodyBold uppercase text-xs">
                          {code}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleSelectLang('auto')}
                    className="w-full py-4 rounded-xl bg-primary/10 border border-primary/20 items-center justify-center border-dashed"
                  >
                    <Text className="text-primary font-bodyBold">
                      Detect Automatically
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {overlayStep === OverlayStep.Preview && (
                <Animated.View
                  entering={FadeIn}
                  exiting={FadeOut}
                  className="items-center"
                >
                  <View className="w-full h-24 justify-center px-4 mb-2">
                    <AudioWaveform
                      amplitudes={
                        player.realWaveform.length > 0
                          ? player.realWaveform
                          : Array.from({ length: 50 }, () => -120)
                      }
                      progress={player.progress / player.duration}
                      height={60}
                      width={SCREEN.width - 80}
                      interactive={!player.isDecoding}
                      onSeek={handleSeek}
                    />
                  </View>

                  <Text className="text-zinc-500 font-bodyMed text-[10px] mb-6">
                    {player.isDecoding
                      ? 'Decoding Audio Engine...'
                      : `${Math.floor(player.progress)}s / ${Math.floor(player.duration)}s`}
                  </Text>

                  <View className="flex-row gap-4 w-full">
                    <TouchableOpacity
                      onPress={() =>
                        player.isPlaying ? player.pause() : player.play()
                      }
                      disabled={player.isDecoding}
                      className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'} ${player.isDecoding ? 'opacity-50' : ''}`}
                    >
                      {player.isDecoding ? (
                        <ActivityIndicator
                          size="small"
                          color={foregroundColor}
                        />
                      ) : player.isPlaying ? (
                        <>
                          <LucidePause size={18} color={foregroundColor} />
                          <Text className="text-foreground font-bodyBold">
                            Pause
                          </Text>
                        </>
                      ) : (
                        <>
                          <LucidePlay size={18} color={foregroundColor} />
                          <Text className="text-foreground font-bodyBold">
                            Play
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleTranscribe}
                      className="flex-[2] flex-row h-14 bg-primary rounded-2xl items-center justify-center gap-2 shadow-lg shadow-primary/20"
                    >
                      <LucideZap size={18} color="white" />
                      <Text className="text-white font-bodyBold">
                        Transcribe Now
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              )}

              {overlayStep === OverlayStep.Process && (
                <Animated.View
                  entering={FadeIn}
                  exiting={FadeOut}
                  className="items-center py-10"
                >
                  <LucideLoader2
                    size={32}
                    color={primaryColor}
                    className="animate-spin"
                  />
                  <Text className="text-foreground font-bodyBold mt-6">
                    Analyzing Audio Peaks
                  </Text>
                  <Text className="text-zinc-500 text-xs font-bodyMed mt-1">
                    This takes a few seconds...
                  </Text>
                </Animated.View>
              )}

              {overlayStep === OverlayStep.Result && (
                <Animated.View entering={FadeIn} exiting={FadeOut}>
                  {!transcription ? (
                    <View className="items-center py-6">
                      <Text className="text-red-500 font-bodyBold">
                        Transcription Failed
                      </Text>
                      <Text className="text-zinc-500 text-center text-xs mt-2 px-6">
                        The audio was too noisy or empty. Please try again with
                        a different clip.
                      </Text>
                      <TouchableOpacity
                        onPress={() => setOverlayState(true, OverlayStep.Pick)}
                        className="mt-6 py-3 px-8 bg-zinc-900 rounded-xl"
                      >
                        <Text className="text-white font-bodyBold">
                          Try Again
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View className="flex-row justify-between items-center mb-3">
                        <Text className="text-zinc-500 font-bodyBold text-[10px] uppercase tracking-wider">
                          {showTranslation ? 'Translation' : 'Transcription'}
                        </Text>
                        {translation && (
                          <TouchableOpacity
                            onPress={() => {
                              setShowTranslation(!showTranslation);
                              Haptics.selectionAsync();
                            }}
                            className="flex-row items-center gap-1"
                          >
                            <Text className="text-primary font-bodyBold text-[10px] uppercase">
                              {showTranslation
                                ? 'Show Original'
                                : 'Show Translation'}
                            </Text>
                            <LucideChevronRight
                              size={10}
                              color={primaryColor}
                            />
                          </TouchableOpacity>
                        )}
                      </View>

                      <ScrollView
                        className="max-h-[220px] mb-6"
                        showsVerticalScrollIndicator={false}
                      >
                        <Text className="text-foreground text-base font-body leading-7">
                          {showTranslation ? translation : transcription}
                        </Text>
                      </ScrollView>
                      <View className="flex-row gap-3">
                        <TouchableOpacity
                          onPress={handleCopy}
                          className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'}`}
                        >
                          <LucideCopy size={16} color={foregroundColor} />
                          <Text className="text-foreground font-bodyBold">
                            Copy Text
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleTranslate}
                          disabled={isTranslating}
                          className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 transition-all ${isTranslating ? 'opacity-50' : ''} ${showTranslation ? 'bg-primary/10 border-primary/20' : 'bg-primary border-primary'} shadow-lg shadow-primary/20`}
                        >
                          {isTranslating ? (
                            <ActivityIndicator
                              size="small"
                              color={showTranslation ? primaryColor : 'white'}
                            />
                          ) : (
                            <Text
                              className={`font-bodyBold ${showTranslation ? 'text-primary' : 'text-white'}`}
                            >
                              {showTranslation ? 'Translated' : 'Translate'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </Animated.View>
              )}
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};
