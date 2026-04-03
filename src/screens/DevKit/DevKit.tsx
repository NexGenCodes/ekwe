import {
  Mic,
  Check,
  AlertTriangle,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  Share,
  Search,
  Star,
  Sun,
  Moon,
  Smartphone,
  Clock,
  Settings,
  Home,
  Loader,
  LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioWaveform } from 'src/components/common/AudioWaveform';
import { EkweBanner } from 'src/components/common/EkweBanner';
import { EkweButton } from 'src/components/common/EkweButton';
import { ThemeToggler } from 'src/components/common/ThemeToggler';
import { useTheme } from 'src/hooks/useTheme';

const Icons: Record<string, LucideIcon> = {
  Mic,
  Check,
  AlertTriangle,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  Share,
  Search,
  Star,
  Sun,
  Moon,
  Smartphone,
  Clock,
  Settings,
  Home,
  Loader,
};

export const DevKit = (): React.ReactElement => {
  const { tokens } = useTheme();
  const [bannerVisible, setBannerVisible] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0.3);

  const renderSection = (
    title: string,
    children: React.ReactNode,
  ): React.ReactElement => (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionTitle,
          {
            color: tokens.color.text.tertiary,
            fontFamily: tokens.font.family.bodyMed,
          },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.headerTitle,
            {
              color: tokens.color.text.primary,
              fontFamily: tokens.font.family.display,
            },
          ]}
        >
          Ekwe DevKit
        </Text>
        <ThemeToggler />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Typography */}
        {renderSection(
          'Typography',
          <View>
            <Text
              style={{
                fontFamily: tokens.font.family.display,
                fontSize: tokens.font.size.display,
                color: tokens.color.text.primary,
              }}
            >
              Display Text
            </Text>
            <Text
              style={{
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.heading,
                color: tokens.color.text.primary,
                marginTop: 8,
              }}
            >
              Heading Medium
            </Text>
            <Text
              style={{
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
                color: tokens.color.text.secondary,
                marginTop: 4,
              }}
            >
              Body Regular - The quick brown fox jumps over the lazy dog.
            </Text>
            <Text
              style={{
                fontFamily: tokens.font.family.mono,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
                marginTop: 4,
              }}
            >
              Mono Caption: 0123456789
            </Text>
          </View>,
        )}

        {/* Buttons */}
        {renderSection(
          'Buttons',
          <View style={styles.grid}>
            <EkweButton
              label="Primary"
              onPress={(): void => {}}
              variant="primary"
              style={styles.gridItem}
            />
            <EkweButton
              label="Secondary"
              onPress={(): void => {}}
              variant="secondary"
              style={styles.gridItem}
            />
            <EkweButton
              label="Outline"
              onPress={(): void => {}}
              variant="outline"
              style={styles.gridItem}
            />
            <EkweButton
              label="Ghost"
              onPress={(): void => {}}
              variant="ghost"
              style={styles.gridItem}
            />
            <EkweButton
              label="Loading"
              onPress={(): void => {}}
              loading
              style={styles.gridItem}
            />
            <EkweButton
              label="Disabled"
              onPress={(): void => {}}
              disabled
              style={styles.gridItem}
            />
          </View>,
        )}

        {/* Banner */}
        {renderSection(
          'Banner',
          <View>
            <EkweButton
              label={bannerVisible ? 'Hide Banner' : 'Show Banner'}
              onPress={(): void => setBannerVisible(!bannerVisible)}
              style={{ marginBottom: 12 }}
            />
            <EkweBanner
              visible={bannerVisible}
              title="Welcome to Ekwe"
              message="This is a glassmorphism banner with Reanimated transitions."
              variant="success"
              onClose={(): void => setBannerVisible(false)}
            />
          </View>,
        )}

        {/* Waveform */}
        {renderSection(
          'Audio Waveform',
          <View>
            <AudioWaveform
              amplitudes={[0.2, 0.5, 0.8, 0.4, 0.6, 0.9, 0.3, 0.5, 0.7, 0.4]}
              progress={progress}
              onSeek={(p: number): void => setProgress(p)}
              width={300}
              height={60}
            />
            <Text
              style={{
                color: tokens.color.text.tertiary,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              Progress: {(progress * 100).toFixed(0)}%
            </Text>
          </View>,
        )}

        {/* Icons Grid */}
        {renderSection(
          'Icons',
          <View style={styles.iconGrid}>
            {Object.entries(Icons).map(
              ([name, Icon]): React.ReactElement => (
                <View key={name} style={styles.iconItem}>
                  <Icon
                    size={24}
                    color={tokens.color.brand.core}
                    strokeWidth={2.5}
                  />
                  <Text style={styles.iconLabel} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              ),
            )}
          </View>,
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  headerTitle: {
    fontSize: 24,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionContent: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    minWidth: '45%',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  iconItem: {
    width: '22%',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconLabel: {
    fontSize: 8,
    marginTop: 4,
    color: '#888',
  },
});
