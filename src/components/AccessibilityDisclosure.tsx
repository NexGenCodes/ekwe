import { Image as ExpoImage } from 'expo-image';
import {
  LucideShieldCheck,
  LucideBatteryCharging,
  LucideZap,
} from 'lucide-react-native';
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/hooks';

export interface AccessibilityDisclosureProps {
  onAgree: () => void;
  onDeny: () => void;
}

export const AccessibilityDisclosure: React.FC<
  AccessibilityDisclosureProps
> = ({ onAgree, onDeny }) => {
  const { color } = useTheme();
  const primaryColor = color.primary;

  return (
    <View style={[styles.container, { backgroundColor: color.background }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View
          entering={FadeInDown.duration(500).springify()}
          style={styles.titleSection}
        >
          <Text style={[styles.title, { color: color.foreground }]}>
            Accessibility Service Disclosure
          </Text>
          <View
            style={[
              styles.infoBox,
              {
                backgroundColor: `${primaryColor}1A`,
                borderColor: `${primaryColor}33`,
              },
            ]}
          >
            <Text style={[styles.infoBoxTitle, { color: primaryColor }]}>
              Google Play Policy Requirement
            </Text>
            <Text style={[styles.infoBoxBody, { color: color.foreground }]}>
              This app uses the{' '}
              <Text style={styles.boldText}>AccessibilityService API</Text> to
              detect when you open messaging applications (like WhatsApp or
              Tinder). This allows Ekwe to automatically display the floating
              translation tool over your screen exactly when you need it.
            </Text>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(500).delay(100).springify()}
          style={styles.featuresSection}
        >
          <View style={styles.featureRow}>
            <View
              style={[
                styles.featureIcon,
                { backgroundColor: `${primaryColor}1A` },
              ]}
            >
              {process.env.EXPO_OS === 'ios' ? (
                <ExpoImage
                  source="sf:bolt.fill"
                  style={{ width: 24, height: 24 }}
                  tintColor={primaryColor}
                />
              ) : (
                <LucideZap size={24} color={primaryColor} />
              )}
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={[styles.featureTitle, { color: color.foreground }]}>
                Contextual App Detection
              </Text>
              <Text style={[styles.featureBody, { color: color.muted }]}>
                We strictly monitor top-level window transitions to identify
                when a target messaging app is launched. We do NOT read your
                chat messages.
              </Text>
            </View>
          </View>

          <View style={styles.featureRow}>
            <View
              style={[
                styles.featureIcon,
                { backgroundColor: 'rgba(34, 197, 94, 0.1)' },
              ]}
            >
              {process.env.EXPO_OS === 'ios' ? (
                <ExpoImage
                  source="sf:battery.100.bolt"
                  style={{ width: 24, height: 24 }}
                  tintColor="#22C55E"
                />
              ) : (
                <LucideBatteryCharging size={24} color="#22C55E" />
              )}
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={[styles.featureTitle, { color: color.foreground }]}>
                Battery Optimized
              </Text>
              <Text style={[styles.featureBody, { color: color.muted }]}>
                Utilizing native Accessibility signals prevents aggressive
                background polling, ensuring your phone's battery isn't drained.
              </Text>
            </View>
          </View>

          <View style={styles.featureRow}>
            <View
              style={[
                styles.featureIcon,
                { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
              ]}
            >
              {process.env.EXPO_OS === 'ios' ? (
                <ExpoImage
                  source="sf:shield.fill"
                  style={{ width: 24, height: 24 }}
                  tintColor="#3B82F6"
                />
              ) : (
                <LucideShieldCheck size={24} color="#3B82F6" />
              )}
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={[styles.featureTitle, { color: color.foreground }]}>
                Zero Data Collection
              </Text>
              <Text style={[styles.featureBody, { color: color.muted }]}>
                We{' '}
                <Text style={styles.boldText}>
                  do not collect, store, transmit, or share
                </Text>{' '}
                any data, text, or inputs captured by this service. The
                implementation acts exclusively as a local UI trigger.
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Fixed Bottom Action Bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: color.background, borderTopColor: color.border },
        ]}
      >
        <TouchableOpacity
          onPress={onAgree}
          style={[styles.primaryButton, { backgroundColor: primaryColor }]}
          accessibilityRole="button"
          accessibilityLabel="I agree to accessibility permissions"
        >
          <Text style={styles.primaryButtonText}>I Agree</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDeny}
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Decline accessibility permissions"
        >
          <Text style={[styles.secondaryButtonText, { color: color.muted }]}>
            Decline
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  titleSection: { marginTop: 32, marginBottom: 32 },
  title: {
    fontFamily: 'Outfit-Medium',
    fontSize: 32,
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  infoBox: { marginTop: 16, padding: 16, borderRadius: 16, borderWidth: 1 },
  infoBoxTitle: { fontFamily: 'Outfit-Medium', fontSize: 15, marginBottom: 4 },
  infoBoxBody: { fontFamily: 'Outfit-Regular', fontSize: 14, lineHeight: 24 },
  boldText: { fontFamily: 'Outfit-Medium' },
  featuresSection: { gap: 24, marginBottom: 160 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  featureIcon: { padding: 12, borderRadius: 16 },
  featureTextContainer: { flex: 1, paddingRight: 8 },
  featureTitle: { fontFamily: 'Outfit-Medium', fontSize: 16, marginBottom: 4 },
  featureBody: { fontFamily: 'Outfit-Regular', fontSize: 14, lineHeight: 20 },
  bottomBar: {
    paddingTop: 16,
    paddingBottom: 40,
    paddingHorizontal: 24,
    borderTopWidth: 1,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 16,
    marginTop: 4,
    alignItems: 'center',
    borderRadius: 16,
  },
  secondaryButtonText: { fontFamily: 'Outfit-Medium', fontSize: 15 },
});
