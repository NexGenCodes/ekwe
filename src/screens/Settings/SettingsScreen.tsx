import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRightIcon } from 'src/assets/icons/ChevronRightIcon';
import { LanguagePickerSheet } from 'src/components/common/LanguagePickerSheet';
import { ThemeToggler } from 'src/components/common/ThemeToggler';
import { useTheme } from 'src/hooks/useTheme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

export const SettingsScreen = ({
  navigation,
}: MainTabScreenProps<'Settings'>): React.ReactElement => {
  const { tokens } = useTheme();
  const [sheetVisible, setSheetVisible] = useState(false);

  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  const handleLanguageChange = (sel: string[], pins: string[]): void => {
    setSelectedLanguages(sel);
    setPinnedLanguages(pins);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.heading,
                color: tokens.color.text.primary,
              },
            ]}
          >
            Settings
          </Text>
        </View>

        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
              },
            ]}
          >
            APPEARANCE
          </Text>
          <View
            style={[
              styles.row,
              {
                backgroundColor: tokens.color.background.secondary,
                borderRadius: tokens.radius.md,
                marginTop: tokens.space[2],
              },
            ]}
          >
            <Text
              style={[
                styles.rowLabel,
                {
                  fontFamily: tokens.font.family.body,
                  fontSize: tokens.font.size.body,
                  color: tokens.color.text.primary,
                },
              ]}
            >
              Theme
            </Text>
            <ThemeToggler />
          </View>
        </View>

        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
              },
            ]}
          >
            LANGUAGES
          </Text>
          <Pressable
            onPress={() => setSheetVisible(true)}
            style={[
              styles.row,
              {
                backgroundColor: tokens.color.background.secondary,
                borderRadius: tokens.radius.md,
                marginTop: tokens.space[2],
              },
            ]}
          >
            <View style={styles.rowLeft}>
              <Text
                style={[
                  styles.rowLabel,
                  {
                    fontFamily: tokens.font.family.body,
                    fontSize: tokens.font.size.body,
                    color: tokens.color.text.primary,
                  },
                ]}
              >
                Selected
              </Text>
              <Text
                style={[
                  styles.rowValue,
                  {
                    fontFamily: tokens.font.family.body,
                    fontSize: tokens.font.size.caption,
                    color: tokens.color.text.tertiary,
                    marginTop: 2,
                  },
                ]}
              >
                {selectedLanguages.length} active
              </Text>
            </View>
            <ChevronRightIcon size={20} color={tokens.color.text.tertiary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
              },
            ]}
          >
            ABOUT
          </Text>
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: tokens.color.background.secondary,
                borderRadius: tokens.radius.md,
                marginTop: tokens.space[2],
              },
            ]}
          >
            <View style={styles.infoRow}>
              <Text
                style={[
                  styles.infoLabel,
                  { color: tokens.color.text.tertiary },
                ]}
              >
                Version
              </Text>
              <Text
                style={[styles.infoValue, { color: tokens.color.text.primary }]}
              >
                1.0.0 (Phase 4)
              </Text>
            </View>
            <View
              style={[
                styles.divider,
                { backgroundColor: tokens.color.border.default },
              ]}
            />
            <View style={styles.infoRow}>
              <Text
                style={[
                  styles.infoLabel,
                  { color: tokens.color.text.tertiary },
                ]}
              >
                Developer
              </Text>
              <Text
                style={[styles.infoValue, { color: tokens.color.text.primary }]}
              >
                Ekwe Team
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <LanguagePickerSheet
        isVisible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        selectedLanguages={selectedLanguages}
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={handleLanguageChange}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 16,
  },
  title: {
    letterSpacing: -0.5,
  },
  section: {
    marginTop: 32,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    letterSpacing: 1,
    paddingLeft: 4,
  },
  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  rowLeft: {
    flex: 1,
  },
  rowLabel: {},
  rowValue: {},
  infoCard: {
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 0.5,
    marginVertical: 4,
  },
});
