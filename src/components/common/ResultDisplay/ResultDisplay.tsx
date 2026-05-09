import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { getColor } from '@/constants/colors';
import { FLAG_MAP } from '@/constants/languages';

interface ResultDisplayProps {
  transcription: string | null;
  translation: string | null;
  defaultTab?: 'Translation' | 'Transcription';
  onTabChange?: (tab: 'Translation' | 'Transcription') => void;
  isDark?: boolean;
  sourceLang?: string | null;
  targetLang?: string | null;
}

/**
 * ResultDisplay
 *
 * Self-contained tabbed view for transcription/translation results.
 * Manages its own active tab state internally. Parent can listen
 * via `onTabChange` if it needs to know (e.g. for a Copy button).
 */
export const ResultDisplay: React.FC<ResultDisplayProps> = ({
  transcription,
  translation,
  defaultTab = 'Translation',
  onTabChange,
  isDark = false,
  sourceLang,
  targetLang,
}) => {
  const [activeTab, setActiveTab] = useState<'Translation' | 'Transcription'>(
    defaultTab,
  );

  const brandPrimary = getColor('primary', isDark);
  const textPrimary = getColor('foreground', isDark);
  const textSecondary = getColor('muted', isDark);
  const bgMain = getColor('background', isDark);
  const handleHex = getColor('border', isDark);

  const handleTabPress = (tab: 'Translation' | 'Transcription'): void => {
    Haptics.selectionAsync();
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.segmentContainer,
            { backgroundColor: bgMain, borderColor: handleHex, borderWidth: 1 },
          ]}
        >
          <TouchableOpacity
            onPress={() => handleTabPress('Translation')}
            style={[
              styles.segmentBtn,
              activeTab === 'Translation' && { backgroundColor: brandPrimary },
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: activeTab === 'Translation' ? '#FFF' : textSecondary },
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
                  color: activeTab === 'Transcription' ? '#FFF' : textSecondary,
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

      <BottomSheetScrollView
        style={[
          styles.scrollBody,
          { backgroundColor: bgMain, borderColor: handleHex },
        ]}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={[styles.resultTxt, { color: textPrimary }]}>
          {activeTab === 'Translation' ? translation : transcription}
        </Text>
      </BottomSheetScrollView>
    </View>
  );
};

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
    fontSize: 12,
    fontWeight: '700',
  },
  scrollBody: {
    minHeight: 120,
    maxHeight: 280,
    borderRadius: 24,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  resultTxt: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
