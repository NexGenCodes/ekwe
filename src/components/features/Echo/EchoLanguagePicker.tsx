import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React from 'react';

import { LanguageGrid } from './LanguageGrid';

import { Box, Text } from '@/components/ui';
import { STEP_METADATA } from '@/constants/echo';
import { spacing } from '@/constants/spacing';

export interface EchoLanguagePickerProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

export const EchoLanguagePicker: React.FC<EchoLanguagePickerProps> = React.memo(
  ({ selectedLang, onSelect }) => {
    return (
      <Box>
        <Text variant="heading3" style={{ marginBottom: spacing.lg }}>
          {STEP_METADATA.PickLanguage.title}
        </Text>
        <BottomSheetScrollView showsVerticalScrollIndicator={false}>
          <LanguageGrid selectedLang={selectedLang} onSelect={onSelect} />
        </BottomSheetScrollView>
      </Box>
    );
  },
);
