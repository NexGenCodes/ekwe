import NetInfo from '@react-native-community/netinfo';
import { FlashList } from '@shopify/flash-list';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrumIcon } from 'src/assets/icons/DrumIcon';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { HistoryItem } from 'src/components/cards/HistoryItem';
import { EkweBanner, BannerPresets } from 'src/components/common/EkweBanner';
import { EkweButton } from 'src/components/common/EkweButton';
import { LANGUAGES } from 'src/constants/languages';
import { MOCK_HISTORY } from 'src/constants/mockData';
import { useTheme } from 'src/hooks/useTheme';
import { MainTabScreenProps } from 'src/navigation/types';
import { useHistoryStore, useSettingsStore } from 'src/store';
import { HistoryEntry } from 'src/store/historySlice';

export const HomeScreen = ({
  navigation,
}: MainTabScreenProps<'Home'>): React.ReactElement => {
  const { tokens } = useTheme();
  const [isOffline, setIsOffline] = useState(false);
  const entries = useHistoryStore((s) => s.entries);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);

  // Fallback to mock data in Phase 4 for display purposes
  const displayEntries = entries.length > 0 ? entries : MOCK_HISTORY;
  const targetLang = selectedLanguages[0] ?? 'en';

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOffline(!(state.isConnected ?? true));
    });
    return unsub;
  }, []);

  const handlePillPress = (code: string): void => {
    const next = [code, ...selectedLanguages.filter((l) => l !== code)];
    setSelectedLanguages(next);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: tokens.color.brand.navy }]}
    >
      <View
        style={[
          styles.content,
          { backgroundColor: tokens.color.background.primary },
        ]}
      >
        {/* Header (Navy) */}
        <View
          style={[styles.header, { backgroundColor: tokens.color.brand.navy }]}
        >
          <EkweWordmark size={24} color={tokens.color.text.inverse} />
        </View>

        {/* Language Pills (Navy) */}
        <View
          style={[
            styles.pillsWrapper,
            { backgroundColor: tokens.color.brand.navy },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsScroll}
          >
            {selectedLanguages.map((code): React.ReactElement => {
              const lang = LANGUAGES.find((l) => l.code === code);
              const isActive = code === targetLang;
              return (
                <Pressable
                  key={code}
                  onPress={() => handlePillPress(code)}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: isActive
                        ? tokens.color.brand.core
                        : 'rgba(255,255,255,0.12)',
                      marginRight: tokens.space[2],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      {
                        fontFamily: tokens.font.family.body,
                        fontSize: tokens.font.size.caption,
                        color: isActive
                          ? tokens.color.text.inverse
                          : tokens.color.text.inverse + 'A6',
                      },
                    ]}
                  >
                    {(lang?.englishName ?? code).toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollBodyContent}
        >
          <EkweButton
            variant="secondary"
            size="large"
            label="Share voice note"
            style={styles.shareButton}
            onPress={() => Alert.alert('Share feature coming soon.')}
          />

          {isOffline && (
            <EkweBanner
              {...BannerPresets.noInternet}
              style={styles.banner}
              visible
            />
          )}

          <Text
            style={[
              styles.sectionHeader,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
                paddingTop: tokens.space[4],
                paddingBottom: tokens.space[2],
              },
            ]}
          >
            RECENT
          </Text>

          <View style={styles.listContainer}>
            {displayEntries.length > 0 ? (
              <FlashList<HistoryEntry>
                data={displayEntries}
                keyExtractor={(item) => item.id}
                renderItem={({ item }): React.ReactElement => (
                  <HistoryItem
                    entry={item}
                    onPress={() =>
                      navigation.navigate('Result', { entryId: item.id })
                    }
                    onDelete={() => deleteEntry(item.id)}
                  />
                )}
              />
            ) : (
              <View style={styles.emptyState}>
                <DrumIcon size={48} color={tokens.color.text.tertiary} />
                <Text
                  style={[
                    styles.emptyTitle,
                    {
                      fontFamily: tokens.font.family.body,
                      color: tokens.color.text.tertiary,
                      marginTop: tokens.space[3],
                    },
                  ]}
                >
                  No translations yet
                </Text>
                <Text
                  style={[
                    styles.emptySubtitle,
                    {
                      fontFamily: tokens.font.family.body,
                      color: tokens.color.text.tertiary,
                      marginTop: tokens.space[2],
                    },
                  ]}
                >
                  Share a voice note or tap the bubble to get started
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  header: {
    height: 44,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pillsWrapper: {
    paddingBottom: 12,
  },
  pillsScroll: {
    paddingLeft: 16,
  },
  pill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: {
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  scrollBody: {
    flex: 1,
  },
  scrollBodyContent: {
    paddingBottom: 40,
  },
  shareButton: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    letterSpacing: 1,
  },
  listContainer: {
    flex: 1,
    minHeight: 300,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    textAlign: 'center',
    fontSize: 16,
  },
  emptySubtitle: {
    textAlign: 'center',
    fontSize: 14,
  },
});
