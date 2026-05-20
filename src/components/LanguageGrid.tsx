import { useSelector } from '@legendapp/state/react';
import { Globe } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ECHO_CONSTANTS } from '@/constants/echo';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
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
    <View style={styles.grid}>
      {topLanguages.map((lang) => (
        <TouchableOpacity
          key={lang!.code}
          onPress={() => onSelect(lang!.code)}
          style={[
            styles.card,
            {
              backgroundColor: color.background,
              borderColor:
                selectedLang === lang!.code ? color.secondary : color.border,
            },
          ]}
        >
          <Text style={styles.flag}>{FLAG_MAP[lang!.code] || '🌐'}</Text>
          <Text style={[styles.name, { color: color.foreground }]}>
            {lang!.englishName}
          </Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
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
        style={[
          styles.card,
          styles.autoCard,
          {
            backgroundColor: color.background,
            borderColor: color.primary,
            opacity: canUseAuto ? 1 : 0.5,
          },
        ]}
      >
        <Globe
          size={24}
          color={canUseAuto ? color.primary : color.primary}
          style={{ marginBottom: 4 }}
        />
        <Text
          style={[
            styles.autoText,
            { color: canUseAuto ? color.primary : color.primary },
          ]}
        >
          Auto-Detect
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ECHO_CONSTANTS.LANGUAGE_GRID.GAP,
  },
  card: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: ECHO_CONSTANTS.LANGUAGE_GRID.CARD_RADIUS,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  autoCard: {
    borderStyle: 'dashed',
  },
  flag: {
    fontSize: 24,
    marginBottom: 4,
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  autoText: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
});
