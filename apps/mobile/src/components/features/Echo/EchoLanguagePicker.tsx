import React from "react";
import { ScrollView } from "react-native";

import { LanguageGrid } from "./LanguageGrid";

import { Box, Text } from "@/components/ui";
import { STEP_METADATA } from "@/constants/echo";
import { useTokens } from "@/hooks/ui";

export interface EchoLanguagePickerProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

export const EchoLanguagePicker: React.FC<EchoLanguagePickerProps> = React.memo(
  ({ selectedLang, onSelect }) => {
    const { spacing } = useTokens();

    return (
      <Box>
        <Text variant="heading3" style={{ marginBottom: spacing.lg }}>
          {STEP_METADATA.PickLanguage.title}
        </Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <LanguageGrid selectedLang={selectedLang} onSelect={onSelect} />
        </ScrollView>
      </Box>
    );
  },
);
