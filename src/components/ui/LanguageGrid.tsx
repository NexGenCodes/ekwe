import { Globe } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ECHO_CONSTANTS } from '@/constants/echo';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { useSettingsStore } from '@/store';

interface LanguageGridProps {
  selectedLang: string;
  onSelect: (code: string) => void;
  isDark?: boolean;
}

import { useTheme } from '@/hooks';

/**
 * LanguageGrid
 *
 * A 3-column grid showing the top 5 most used languages + an Auto-Detect option.
 */
export const LanguageGrid: React.FC<LanguageGridProps> = ({
  selectedLang,
  onSelect,
  isDark = false,
}) => {
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const { color } = useTheme();
  const textPrimary = color.foreground;
  const brandPrimary = color.primary;
  const bgMain = color.background;
  const handleHex = color.border;

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
              backgroundColor: bgMain,
              borderColor:
                selectedLang === lang!.code ? brandPrimary : handleHex,
            },
          ]}
        >
          <Text style={styles.flag}>{FLAG_MAP[lang!.code] || '🌐'}</Text>
          <Text style={[styles.name, { color: textPrimary }]}>
            {lang!.englishName}
          </Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        onPress={() => onSelect('auto')}
        style={[
          styles.card,
          styles.autoCard,
          {
            backgroundColor: bgMain,
            borderColor: selectedLang === 'auto' ? brandPrimary : handleHex,
          },
        ]}
      >
        <Globe size={24} color={brandPrimary} style={{ marginBottom: 4 }} />
        <Text style={[styles.autoText, { color: brandPrimary }]}>
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
