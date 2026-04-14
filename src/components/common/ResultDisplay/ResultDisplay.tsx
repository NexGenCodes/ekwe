import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';

import { getColor } from '@/constants/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ResultDisplayProps {
  transcription: string | null;
  translation: string | null;
  activeTab: 'Translation' | 'Transcription';
  onTabChange: (tab: 'Translation' | 'Transcription') => void;
  isDark?: boolean;
}

/**
 * ResultDisplay
 *
 * A reusable tabbed view for displaying dual-results (e.g. Transcription and Translation).
 */
export const ResultDisplay: React.FC<ResultDisplayProps> = ({
  transcription,
  translation,
  activeTab,
  onTabChange,
  isDark = false,
}) => {
  const brandPrimary = getColor('primary', isDark);
  const textPrimary = getColor('foreground', isDark);
  const textSecondary = getColor('muted', isDark);
  const bgMain = getColor('background', isDark);
  const handleHex = getColor('border', isDark);

  const handleTabPress = (tab: 'Translation' | 'Transcription'): void => {
    Haptics.selectionAsync();
    onTabChange(tab);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.segmentContainer, { backgroundColor: bgMain }]}>
        <TouchableOpacity
          onPress={() => handleTabPress('Transcription')}
          style={[
            styles.segmentBtn,
            activeTab === 'Transcription' && { backgroundColor: handleHex },
          ]}
        >
          <Text
            style={[
              styles.tabLabel,
              {
                color:
                  activeTab === 'Transcription' ? textPrimary : textSecondary,
              },
            ]}
          >
            Original
          </Text>
        </TouchableOpacity>
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
            Translation
          </Text>
        </TouchableOpacity>
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
  container: { marginTop: 0 },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
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
    maxHeight: SCREEN_HEIGHT * 0.3,
    minHeight: 120,
    borderRadius: 24,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  scrollContent: {
    padding: 16,
  },
  resultTxt: {
    fontSize: 17,
    lineHeight: 28,
    fontWeight: '500',
  },
});
