import {
  Mic,
  Check,
  AlertTriangle,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  Share,
  Search,
  Star,
  Sun,
  Moon,
  Smartphone,
  Clock,
  Settings,
  Home,
  Loader,
  LucideIcon,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { TranscriptCard } from 'src/components/cards/TranscriptCard';
import { TranslationCard } from 'src/components/cards/TranslationCard';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { EkweBanner } from 'src/components/common/EkweBanner';
import { EkweButton } from 'src/components/common/EkweButton';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { PermissionGate } from 'src/components/common/PermissionGate';
import { ThemeToggler } from 'src/components/common/ThemeToggler';
import { getColor } from 'src/constants/theme';

const Icons: Record<string, LucideIcon> = {
  Mic,
  Check,
  AlertTriangle,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  Share,
  Search,
  Star,
  Sun,
  Moon,
  Smartphone,
  Clock,
  Settings,
  Home,
  Loader,
};

export const DevKit = (): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [bannerVisible, setBannerVisible] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0.3);

  // Phase 3 States
  const [isLangPickerVisible, setIsLangPickerVisible] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['en', 'es']);
  const [pinnedLangs, setPinnedLangs] = useState<string[]>(['en']);

  const renderSection = (
    title: string,
    children: React.ReactNode,
  ): React.ReactElement => (
    <View className="mt-6 px-5">
      <Text className="text-[10px] tracking-[1px] mb-3 text-zinc-500 dark:text-zinc-400 font-bodyMed">
        {title.toUpperCase()}
      </Text>
      <View className="p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900">
        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <Text className="text-2xl font-display text-zinc-950 dark:text-zinc-50">
          Ekwe DevKit
        </Text>
        <ThemeToggler />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Typography */}
        {renderSection(
          'Typography',
          <View>
            <Text className="font-display text-[32px] text-zinc-950 dark:text-zinc-50">
              Display Text
            </Text>
            <Text className="font-bodyMed text-xl text-zinc-950 dark:text-zinc-50 mt-2">
              Heading Medium
            </Text>
            <Text className="font-body text-base text-zinc-600 dark:text-zinc-400 mt-1">
              Body Regular - The quick brown fox jumps over the lazy dog.
            </Text>
            <Text className="font-mono text-xs text-zinc-500 dark:text-zinc-500 mt-1">
              Mono Caption: 0123456789
            </Text>
          </View>,
        )}

        {/* Buttons */}
        {renderSection(
          'Buttons',
          <View className="flex-row flex-wrap gap-3">
            <EkweButton
              label="Primary"
              onPress={(): void => {}}
              variant="primary"
              className="min-w-[45%]"
            />
            <EkweButton
              label="Secondary"
              onPress={(): void => {}}
              variant="secondary"
              className="min-w-[45%]"
            />
            <EkweButton
              label="Outline"
              onPress={(): void => {}}
              variant="outline"
              className="min-w-[45%]"
            />
            <EkweButton
              label="Ghost"
              onPress={(): void => {}}
              variant="ghost"
              className="min-w-[45%]"
            />
            <EkweButton
              label="Loading"
              onPress={(): void => {}}
              loading
              className="min-w-[45%]"
            />
            <EkweButton
              label="Disabled"
              onPress={(): void => {}}
              disabled
              className="min-w-[45%]"
            />
          </View>,
        )}

        {/* Banner */}
        {renderSection(
          'Banner',
          <View>
            <EkweButton
              label={bannerVisible ? 'Hide Banner' : 'Show Banner'}
              onPress={(): void => setBannerVisible(!bannerVisible)}
              style={{ marginBottom: 12 }}
            />
            <EkweBanner
              visible={bannerVisible}
              title="Welcome to Ekwe"
              message="This is a glassmorphism banner with Reanimated transitions."
              variant="success"
              onClose={(): void => setBannerVisible(false)}
            />
          </View>,
        )}

        {/* Waveform */}
        {renderSection(
          'Audio Waveform',
          <View>
            <AudioWaveform
              amplitudes={[0.2, 0.5, 0.8, 0.4, 0.6, 0.9, 0.3, 0.5, 0.7, 0.4]}
              progress={progress}
              onSeek={(p: number): void => setProgress(p)}
              width={300}
              height={60}
            />
            <Text className="text-zinc-500 dark:text-zinc-400 mt-2 text-center font-body text-sm">
              Progress: {(progress * 100).toFixed(0)}%
            </Text>
          </View>,
        )}

        {/* Icons Grid */}
        {renderSection(
          'Icons',
          <View className="flex-row flex-wrap justify-between gap-4">
            {Object.entries(Icons).map(
              ([name, Icon]): React.ReactElement => (
                <View key={name} className="w-[22%] items-center mb-4">
                  <Icon
                    size={24}
                    color={getColor('primaryAccent', isDark)}
                    strokeWidth={2.5}
                  />
                  <Text
                    className="text-[8px] mt-1 text-zinc-500 text-center"
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                </View>
              ),
            )}
          </View>,
        )}

        {/* PermissionGate preview */}
        {renderSection(
          'PermissionGate Preview',
          <View className="border border-zinc-200 dark:border-zinc-800 h-[380px] overflow-hidden rounded-2xl">
            <PermissionGate
              icon={
                <Mic
                  size={64}
                  color={getColor('primaryAccent', isDark)}
                  strokeWidth={1}
                />
              }
              heading="Ekwe needs your microphone"
              body="To capture voice notes playing around you."
              primaryLabel="Enable microphone"
              onPrimary={() => {}}
              secondaryLabel="Not now"
              onSecondary={() => {}}
            />
          </View>,
        )}

        {/* LanguagePickerSheet Preview */}
        {renderSection(
          'LanguagePickerSheet',
          <View>
            <EkweButton
              variant="secondary"
              label="Open language picker"
              onPress={() => setIsLangPickerVisible(true)}
            />
            <Text className="text-zinc-500 dark:text-zinc-400 mt-3 text-center font-body text-sm">
              {selectedLangs.length} languages selected
            </Text>
          </View>,
        )}

        {/* TranscriptCard */}
        {renderSection(
          'TranscriptCard',
          <View className="gap-4">
            <TranscriptCard
              sourceLang="es"
              duration={47}
              isStreaming={false}
              transcript="Buenos días, ¿cómo estás? Espero que hayas dormido bien esta noche."
              onCopy={() => {}}
              onTranslate={() => {}}
              onShare={() => {}}
            />
            <TranscriptCard
              sourceLang="de"
              duration={12}
              isStreaming
              transcript="Ich wollte dir nur sagen"
              onCopy={() => {}}
              onTranslate={() => {}}
              onShare={() => {}}
            />
            <TranscriptCard
              sourceLang="en"
              duration={33}
              isStreaming={false}
              transcript="Buongiorno, come stai?"
              languageMismatch={{ detected: 'Italian', suggested: 'en' }}
              onAcceptMismatch={() => {}}
              onCopy={() => {}}
              onTranslate={() => {}}
              onShare={() => {}}
            />
          </View>,
        )}

        {/* TranslationCard */}
        {renderSection(
          'TranslationCard',
          <View className="gap-4">
            <TranslationCard
              targetLang="en"
              isLoading
              onCopy={() => {}}
              onShare={() => {}}
            />
            <TranslationCard
              targetLang="fr"
              downloadProgress={0.6}
              onCopy={() => {}}
              onShare={() => {}}
            />
            <TranslationCard
              targetLang="en"
              translation="Good morning, how are you? I hope you slept well last night."
              onCopy={() => {}}
              onShare={() => {}}
            />
          </View>,
        )}

        {/* HistoryItem */}
        {renderSection(
          'HistoryItem',
          <View>
            <HistoryItem
              entry={{
                id: 'a1b2c3d4',
                sourceLang: 'es',
                targetLang: 'en',
                transcript: 'Buenos días, ¿cómo estás?',
                timestamp: Date.now(),
                duration: 47,
                sourceApp: 'WhatsApp',
                translation: null,
              }}
              onPress={() => {}}
              onDelete={() => {}}
            />
            <HistoryItem
              entry={{
                id: 'e5f6g7h8',
                sourceLang: 'de',
                targetLang: 'en',
                transcript: 'Ich wollte dir nur sagen dass ich dich vermisse',
                timestamp: Date.now() - 3600000,
                duration: 23,
                sourceApp: 'Telegram',
                translation: null,
              }}
              onPress={() => {}}
              onDelete={() => {}}
            />
            <HistoryItem
              entry={{
                id: 'i9j0k1l2',
                sourceLang: 'fr',
                targetLang: 'en',
                transcript: 'Bonjour comment tu vas',
                timestamp: Date.now() - 86400000,
                duration: 15,
                sourceApp: null,
                translation: null,
              }}
              onPress={() => {}}
              onDelete={() => {}}
            />
          </View>,
        )}
      </ScrollView>

      <LanguagePickerSheet
        isVisible={isLangPickerVisible}
        selectedLanguages={selectedLangs}
        pinnedLanguages={pinnedLangs}
        onSelectionChange={(selected, pinned) => {
          setSelectedLangs(selected);
          setPinnedLangs(pinned);
        }}
        onClose={() => setIsLangPickerVisible(false)}
      />
    </SafeAreaView>
  );
};
