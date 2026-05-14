import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { LanguageGrid } from '@/components';
import { STEP_METADATA } from '@/constants/echo';
import { useTheme } from '@/hooks';

export interface EchoLanguagePickerProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

export const EchoLanguagePicker: React.FC<EchoLanguagePickerProps> = React.memo(
  ({ selectedLang, onSelect }) => {
    const { color } = useTheme();
    const textPrimary = color.foreground;

    return (
      <View>
        <Text style={[styles.stepTitle, { color: textPrimary }]}>
          {STEP_METADATA.PickLanguage.title}
        </Text>
        <BottomSheetScrollView showsVerticalScrollIndicator={false}>
          <LanguageGrid selectedLang={selectedLang} onSelect={onSelect} />
        </BottomSheetScrollView>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  stepTitle: { fontSize: 18, fontWeight: '800', marginBottom: 20 },
});
