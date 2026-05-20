import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ScrollableTextBox } from '@/components';
import { FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';

interface ResultDisplayProps {
  transcription: string | null;
  translation: string | null;
  defaultTab?: 'Translation' | 'Transcription';
  onTabChange?: (tab: 'Translation' | 'Transcription') => void;
  isDark?: boolean;
  sourceLang?: string | null;
  targetLang?: string | null;
  isLoading?: boolean;
}

/**
 * ResultDisplay
 *
 * Self-contained tabbed view for transcription/translation results.
 * Manages its own active tab state internally. Parent can listen
 * via `onTabChange` if it needs to know (e.g. for a Copy button).
 */
export const ResultDisplay: React.FC<ResultDisplayProps> = React.memo(
  ({
    transcription,
    translation,
    defaultTab = 'Translation',
    onTabChange,
    isDark = false,
    sourceLang,
    targetLang,
    isLoading = false,
  }) => {
    const [activeTab, setActiveTab] = useState<'Translation' | 'Transcription'>(
      defaultTab,
    );

    const { color } = useTheme();
    const brandPrimary = color.secondary;
    const textSecondary = color.muted;
    const bgMain = color.surface;
    const handleHex = color.border;

    const handleTabPress = React.useCallback(
      (tab: 'Translation' | 'Transcription'): void => {
        Haptics.selectionAsync();
        setActiveTab(tab);
        onTabChange?.(tab);
      },
      [onTabChange],
    );

    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.segmentContainer,
              {
                backgroundColor: bgMain,
                borderColor: handleHex,
                borderWidth: 1,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => handleTabPress('Translation')}
              style={[
                styles.segmentBtn,
                activeTab === 'Translation' && {
                  backgroundColor: brandPrimary,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: activeTab === 'Translation' ? '#FFF' : textSecondary,
                  },
                ]}
              >
                Translated (
                {targetLang
                  ? `${FLAG_MAP[targetLang] || ''} ${targetLang.toUpperCase()}`
                  : ''}
                )
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleTabPress('Transcription')}
              style={[
                styles.segmentBtn,
                activeTab === 'Transcription' && {
                  backgroundColor: brandPrimary,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color:
                      activeTab === 'Transcription' ? '#FFF' : textSecondary,
                  },
                ]}
              >
                Original (
                {sourceLang
                  ? `${FLAG_MAP[sourceLang] || ''} ${sourceLang.toUpperCase()}`
                  : ''}
                )
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollableTextBox
          text={activeTab === 'Translation' ? translation : transcription}
          height={350}
          variant="default"
          isLoading={isLoading && activeTab === 'Translation'}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    flex: 1,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabLabel: {
    fontFamily: 'Outfit-Bold',
    fontSize: 13,
    letterSpacing: -0.2,
  },
});
