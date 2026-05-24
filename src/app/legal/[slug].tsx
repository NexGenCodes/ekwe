import { useLocalSearchParams, Stack } from 'expo-router';
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { LEGAL_DOCUMENTS } from '@/constants/legal';
import { useTheme } from '@/hooks';

export default function LegalScreen(): React.JSX.Element {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { color } = useTheme();

  const doc = LEGAL_DOCUMENTS[slug || ''];

  const Container = View;
  const containerProps = {
    style: { flex: 1, backgroundColor: color.background },
  };

  if (!doc) {
    return (
      <Container {...containerProps} style={styles.flex1}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: color.muted }]}>
            Document not found.
          </Text>
        </View>
      </Container>
    );
  }

  return (
    <Container {...containerProps} style={styles.flex1}>
      <Stack.Screen
        options={{
          title: doc.title,
          headerShown: true,
          headerTransparent: false,
          headerStyle: {
            backgroundColor: color.background,
          },
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: 'Outfit-Bold',
            color: color.foreground,
          },
          headerTintColor: color.primary,
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <Text style={[styles.lastUpdated, { color: color.muted }]}>
            Last updated: {doc.lastUpdated}
          </Text>
        </Animated.View>

        {doc.sections.map((section, index) => (
          <Animated.View
            key={section.title}
            entering={FadeInDown.delay(150 + index * 50).duration(400)}
            style={[
              styles.sectionCard,
              { backgroundColor: color.card, borderColor: color.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: color.foreground }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: color.muted }]}>
              {section.body}
            </Text>
          </Animated.View>
        ))}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: color.muted }]}>
            © {new Date().getFullYear()} Ekwe. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </Container>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    paddingTop: 16,
  },
  lastUpdated: {
    fontFamily: 'Outfit-Regular',
    fontSize: 13,
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
    marginBottom: 8,
  },
  sectionBody: {
    fontFamily: 'Outfit-Regular',
    fontSize: 15,
    lineHeight: 24,
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 16,
  },
});
