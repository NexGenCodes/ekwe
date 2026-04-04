import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRightIcon } from 'src/assets/icons/ChevronRightIcon';
import { EkweButton } from 'src/components/common/EkweButton';
import { LanguagePickerInline } from 'src/components/common/LanguagePickerInline';
import { useTheme } from 'src/hooks/useTheme';
import { OnboardingScreenProps } from 'src/navigation/types';
import { useSettingsStore } from 'src/store';

export const LanguageScreen = ({
  navigation,
}: OnboardingScreenProps<'Language'>): React.ReactElement => {
  const { tokens } = useTheme();
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backButton}
        >
          <ChevronRightIcon
            size={20}
            color={tokens.color.text.primary}
            style={{ transform: [{ rotate: '180deg' }] }}
          />
        </Pressable>

        <Text
          style={[
            styles.heading,
            {
              fontFamily: tokens.font.family.bodyMed,
              fontSize: tokens.font.size.heading,
              color: tokens.color.text.primary,
              marginTop: tokens.space[4],
            },
          ]}
        >
          Your languages
        </Text>
        <Text
          style={[
            styles.body,
            {
              fontFamily: tokens.font.family.body,
              fontSize: tokens.font.size.body,
              color: tokens.color.text.secondary,
              marginTop: tokens.space[2],
              marginBottom: tokens.space[3],
            },
          ]}
        >
          Pick the ones you use most
        </Text>
      </View>

      <View style={styles.listContainer}>
        <LanguagePickerInline
          selectedLanguages={selectedLanguages}
          pinnedLanguages={pinnedLanguages}
          onSelectionChange={(sel, pins) => {
            setSelectedLanguages(sel);
            setPinnedLanguages(pins);
          }}
        />
      </View>

      <View
        style={[
          styles.bottomArea,
          {
            paddingHorizontal: tokens.space[4],
            paddingBottom: tokens.space[6],
          },
        ]}
      >
        <EkweButton
          variant="primary"
          size="large"
          label="Continue"
          disabled={selectedLanguages.length === 0}
          onPress={() => navigation.navigate('Ready')}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  heading: {
    letterSpacing: -0.5,
  },
  body: {},
  listContainer: {
    flex: 1,
  },
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
  },
});
