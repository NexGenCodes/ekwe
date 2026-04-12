import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  NativeModules,
} from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
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
import { StatusBar } from 'expo-status-bar';

import { AudioWaveform } from '@/components/common/AudioWaveform/AudioWaveform';
import { getColor } from '@/constants/colors';
import { LANGUAGES } from '@/constants/languages';
import { useSharedAudioPlayer } from '@/hooks/useSharedAudioPlayer';
import { useAudioStore, useSettingsStore } from '@/store';
import { OverlayStep } from '@/store/audioSlice';
import { useEchoIntent } from '../hooks/useEchoIntent';

const SCREEN = Dimensions.get('window');
const { EkweNative } = NativeModules;

export function EchoSheet({ standalone = false }: { standalone?: boolean }) {
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

  const { selectedLanguages } = useSettingsStore();
  const player = useSharedAudioPlayer(overlayFileUri);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['45%', '92%'], []);

  const {
    transcription,
    translation,
    isTranslating,
    showTranslation,
    setShowTranslation,
    handleTranscribe,
    handleTranslate,
  } = useEchoIntent(overlayFileUri, player.duration, player.realWaveform);

  const primaryColor = useMemo(() => getColor('primary', isDark), [isDark]);
  const foregroundColor = useMemo(() => getColor('foreground', isDark), [isDark]);
  const mutedColor = useMemo(() => getColor('muted', isDark), [isDark]);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.pause();
    resetAudioState();
    
    if (standalone) {
      EkweNative?.dismissEcho();
    }
  };

  useEffect(() => {
    if (showOverlay) {
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [showOverlay]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsAtIndex={-1}
        appearsAtIndex={0}
        opacity={0.6}
      />
    ),
    [],
  );

  const handleSeek = (percentage: number) => {
    player.seek(percentage * player.duration);
    Haptics.selectionAsync();
  };

  if (!showOverlay) return null;

  return (
    <>
      {/* Immersive Mode: Hide StatusBar when sheet is active */}
      <StatusBar hidden={true} />

      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        onClose={handleClose}
        handleIndicatorStyle={{
          backgroundColor: isDark ? '#3F3F46' : '#E4E4E7',
          width: 40,
        }}
        backgroundStyle={{
          backgroundColor: isDark ? '#09090B' : '#FFFFFF', // SOLID BACKGROUND (as requested)
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
        }}
      >
        <BottomSheetView style={{ flex: 1, padding: 24 }}>
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
                    {LANGUAGES.find((l) => l.code === sourceLang)?.englishName || sourceLang}
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => bottomSheetRef.current?.close()}
              className={`w-8 h-8 rounded-full ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'} items-center justify-center`}
            >
              <LucideX size={16} color={foregroundColor} />
            </TouchableOpacity>
          </View>

          {/* Step 1: Pick Language */}
          {overlayStep === OverlayStep.Pick && (
            <View>
              <Text className="text-foreground font-bodyMed mb-4 px-1">
                Select the audio language:
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                {selectedLanguages.slice(0, 5).map((code) => (
                  <TouchableOpacity
                    key={code}
                    onPress={() => {
                        setSourceLang(code);
                        setOverlayState(true, OverlayStep.Preview);
                    }}
                    className={`px-4 py-2.5 rounded-xl border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'} items-center justify-center`}
                  >
                    <Text className="text-foreground font-bodyBold uppercase text-xs">
                      {code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                onPress={() => {
                    setSourceLang('auto');
                    setOverlayState(true, OverlayStep.Preview);
                }}
                className="w-full py-4 rounded-xl bg-primary/10 border border-primary/20 items-center justify-center border-dashed"
              >
                <Text className="text-primary font-bodyBold">
                  Detect Automatically
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Preview & Playback */}
          {overlayStep === OverlayStep.Preview && (
            <View className="items-center">
              <View className="w-full h-24 justify-center px-4 mb-2">
                <AudioWaveform
                  amplitudes={player.realWaveform.length > 0 ? player.realWaveform : Array.from({ length: 50 }, () => -120)}
                  progress={player.progress / player.duration}
                  height={60}
                  width={SCREEN.width - 80}
                  interactive={!player.isDecoding}
                  onSeek={handleSeek}
                />
              </View>

              <Text className="text-zinc-500 font-bodyMed text-[10px] mb-6">
                {player.isDecoding ? 'Decoding Audio Engine...' : `${Math.floor(player.progress)}s / ${Math.floor(player.duration)}s`}
              </Text>

              <View className="flex-row gap-4 w-full">
                <TouchableOpacity
                  onPress={() => player.isPlaying ? player.pause() : player.play()}
                  disabled={player.isDecoding}
                  className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'} ${player.isDecoding ? 'opacity-50' : ''}`}
                >
                  {player.isPlaying ? <LucidePause size={18} color={foregroundColor} /> : <LucidePlay size={18} color={foregroundColor} />}
                  <Text className="text-foreground font-bodyBold">{player.isPlaying ? 'Pause' : 'Play'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleTranscribe}
                  className="flex-[2] flex-row h-14 bg-primary rounded-2xl items-center justify-center gap-2 shadow-lg shadow-primary/20"
                >
                  <LucideZap size={18} color="white" />
                  <Text className="text-white font-bodyBold">Transcribe Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Step 3: Processing */}
          {overlayStep === OverlayStep.Process && (
            <View className="items-center py-10">
              <LucideLoader2 size={32} color={primaryColor} className="animate-spin" />
              <Text className="text-foreground font-bodyBold mt-6">Analyzing Audio Peaks</Text>
              <Text className="text-zinc-500 text-xs font-bodyMed mt-1">This takes a few seconds...</Text>
            </View>
          )}

          {/* Step 4: Results */}
          {overlayStep === OverlayStep.Result && (
            <View>
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-zinc-500 font-bodyBold text-[10px] uppercase tracking-wider">
                  {showTranslation ? 'Translation' : 'Transcription'}
                </Text>
                {translation && (
                  <TouchableOpacity
                    onPress={() => setShowTranslation(!showTranslation)}
                    className="flex-row items-center gap-1"
                  >
                    <Text className="text-primary font-bodyBold text-[10px] uppercase">
                      {showTranslation ? 'Show Original' : 'Show Translation'}
                    </Text>
                    <LucideChevronRight size={10} color={primaryColor} />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView className="max-h-[220px] mb-6" showsVerticalScrollIndicator={false}>
                <Text className="text-foreground text-base font-body leading-7">
                  {showTranslation ? translation : transcription}
                </Text>
              </ScrollView>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => Clipboard.setStringAsync(showTranslation ? translation : transcription)}
                  className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 border ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-100'}`}
                >
                  <LucideCopy size={16} color={foregroundColor} />
                  <Text className="text-foreground font-bodyBold">Copy Text</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleTranslate}
                  disabled={isTranslating}
                  className={`flex-1 flex-row h-14 rounded-2xl items-center justify-center gap-2 ${showTranslation ? 'bg-primary/10' : 'bg-primary'} shadow-lg shadow-primary/20`}
                >
                  {isTranslating ? <ActivityIndicator size="small" color={showTranslation ? primaryColor : 'white'} /> : (
                    <Text className={`font-bodyBold ${showTranslation ? 'text-primary' : 'text-white'}`}>
                      {showTranslation ? 'Translated' : 'Translate'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>
    </>
  );
}
