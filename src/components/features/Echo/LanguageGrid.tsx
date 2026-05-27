import { useSelector } from '@legendapp/state/react';
import { Globe } from 'lucide-react-native';
import React, { useMemo } from 'react';

import { Box, Text, Pressable } from '@/components/ui';
import { ECHO_CONSTANTS } from '@/constants/echo';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { iconSize, opacity } from '@/constants/sizes';
import { spacing } from '@/constants/spacing';
import { useTheme, usePermissions } from '@/hooks';
import { settings$ } from '@/store';
import { AppAlert } from '@/utils';

interface LanguageGridProps {
  selectedLang: string;
  onSelect: (code: string) => void;
}

/**
 * LanguageGrid
 *
 * A 3-column grid showing the top 5 most used languages + an Auto-Detect option.
 */
export const LanguageGrid: React.FC<LanguageGridProps> = ({
  selectedLang,
  onSelect,
}) => {
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const { color } = useTheme();
  const permissions = usePermissions();
  const canUseAuto = permissions.autoLanguageDetect;

  const topLanguages = useMemo(() => {
    return selectedLanguages
      .slice(0, ECHO_CONSTANTS.LANGUAGE_GRID.MAX_TOP_LANGS)
      .map((code) => LANGUAGES.find((l) => l.code === code))
      .filter(Boolean);
  }, [selectedLanguages]);

  return (
    <Box
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: ECHO_CONSTANTS.LANGUAGE_GRID.GAP,
      }}
    >
      {topLanguages.map((lang) => (
        <Pressable
          key={lang!.code}
          feedback="opacity"
          onPress={() => onSelect(lang!.code)}
          style={{
            width: '30%',
            aspectRatio: 1,
            borderRadius: ECHO_CONSTANTS.LANGUAGE_GRID.CARD_RADIUS,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.md,
            backgroundColor: color.background,
            borderColor:
              selectedLang === lang!.code ? color.secondary : color.border,
          }}
        >
          <Text variant="heading2" style={{ marginBottom: spacing.xs }}>
            {FLAG_MAP[lang!.code] || '🌐'}
          </Text>
          <Text
            variant="caption"
            style={{ textAlign: 'center', color: color.foreground }}
          >
            {lang!.englishName}
          </Text>
        </Pressable>
      ))}

      <Pressable
        feedback="opacity"
        onPress={() => {
          if (canUseAuto) {
            onSelect('auto');
          } else {
            AppAlert.info(
              'Ekwe Pro',
              'Auto-detecting languages is a premium feature. Upgrade to Pro to use this.',
            );
          }
        }}
        style={{
          width: '30%',
          aspectRatio: 1,
          borderRadius: ECHO_CONSTANTS.LANGUAGE_GRID.CARD_RADIUS,
          borderWidth: 1.5,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.md,
          borderStyle: 'dashed',
          backgroundColor: color.background,
          borderColor: color.secondary,
          opacity: canUseAuto ? 1 : opacity.disabled,
        }}
      >
        <Globe
          size={iconSize.md}
          color={color.secondary}
          style={{ marginBottom: spacing.xs }}
        />
        <Text
          variant="caption"
          style={{ textAlign: 'center', color: color.secondary }}
        >
          Auto-Detect
        </Text>
      </Pressable>
    </Box>
  );
};
