import { useSelector } from '@legendapp/state/react';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { LogOut, ChevronRight, UserCircle } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  Pressable,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { LanguagePickerSheet, ThemeToggler, SettingsRow } from '@/components';
import { Card, Badge, SectionHeader } from '@/components/ui';
import { useForegroundApp, useLogout, useTheme, usePermissions } from '@/hooks';
import { supabase } from '@/services/supabase';
import { settings$, settingsActions, auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';
import logger from '@/utils/logger';

export default function SettingsScreen(): React.JSX.Element {
  const [sheetVisible, setSheetVisible] = useState(false);
  const router = useRouter();
  const { color } = useTheme();
  const primaryColor = color.primary;
  const user = useSelector(() => auth$.user.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const { logout } = useLogout();

  const hapticsEnabled = useSelector(() => settings$.hapticsEnabled.get());
  const { setHapticsEnabled } = settingsActions;
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const autoCopy = useSelector(() => settings$.autoCopy.get());
  const { setAutoCopy } = settingsActions;
  const pinnedLanguages = useSelector(() => settings$.pinnedLanguages.get());
  const { setSelectedLanguages, setPinnedLanguages } = settingsActions;

  const rawName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const userEmail = user?.email;
  const userName =
    rawName || (userEmail ? userEmail.split('@')[0] : 'Ekwe User');
  const userTier = isPro ? 'pro' : 'free';
  const permissions = usePermissions();

  const { hasPermission } = useForegroundApp();

  const handleLogout = async (): Promise<void> => {
    await logout();
  };

  const handleDeleteAccount = (): void => {
    AppAlert.confirm(
      'Delete Account',
      'Are you sure you want to permanently delete your account and all associated data? This action cannot be undone.',
      async () => {
        try {
          // 1. Delete user data via Supabase RPC
          // This function must be defined in your Supabase SQL:
          // security definer function delete_user() returns void as $$ ... $$
          const { error } = await supabase.rpc('delete_user');

          if (error) {
            AppAlert.error(
              'Deletion Failed',
              'Could not delete your records. Please contact support.',
            );
            return;
          }

          // 2. Sign out and redirect
          await supabase.auth.signOut();
          router.replace('/');
        } catch (e) {
          logger.error('Account deletion failed:', e);
          AppAlert.error(
            'Critical Error',
            'An error occurred while deleting your account.',
          );
        }
      },
      {
        confirmText: 'Delete Forever',
        isDestructive: true,
      },
    );
  };

  return (
    <View style={[styles.flex1, { backgroundColor: color.background }]}>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: color.background }]}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 64 }}
      >
        {/* Profile Card */}
        <Animated.View
          entering={FadeInUp.duration(600).springify()}
          style={styles.profileCardContainer}
        >
          <Card padding="none" style={styles.profileCard}>
            <View
              style={[
                styles.avatarContainer,
                {
                  backgroundColor: `${primaryColor}1A`,
                  borderColor: `${primaryColor}33`,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: primaryColor }]}>
                {rawName ? (
                  rawName[0].toUpperCase()
                ) : (
                  <UserCircle size={24} color={primaryColor} />
                )}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: color.foreground }]}>
                {userName}
              </Text>
              <Text style={[styles.profileEmail, { color: color.muted }]}>
                {userEmail || 'hello@ekwe.app'}
              </Text>
            </View>
            <Badge
              label={userTier === 'pro' ? 'Pro Plan' : 'Free Plan'}
              variant={userTier === 'pro' ? 'primary' : 'muted'}
            />
          </Card>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(600).delay(100).springify()}
        >
          <SectionHeader title="Configuration" />
          <Card padding="none" overflow style={styles.cardSection}>
            <SettingsRow
              label="Haptic Feedback"
              value={
                <Switch
                  value={hapticsEnabled}
                  onValueChange={(val) => {
                    setHapticsEnabled(val);
                  }}
                  trackColor={{
                    true: primaryColor,
                    false: color.border,
                  }}
                  thumbColor="#FFFFFF"
                />
              }
            />
            <SettingsRow label="App Theme" value={<ThemeToggler />} />
          </Card>

          <SectionHeader title="Smart Features" />
          <Card padding="none" overflow style={styles.cardSection}>
            <SettingsRow
              label="Auto-copy to Clipboard"
              isLocked={!permissions.autoCopy}
              value={
                <Switch
                  value={permissions.autoCopy ? autoCopy : false}
                  onValueChange={(val) => {
                    setAutoCopy(val);
                  }}
                  trackColor={{
                    true: primaryColor,
                    false: color.border,
                  }}
                  thumbColor="#FFFFFF"
                  disabled={!permissions.autoCopy}
                />
              }
            />
            <SettingsRow
              label="App-Context Awareness"
              isLocked={!permissions.contextAwareness}
              value={
                <Switch
                  value={!!hasPermission}
                  onValueChange={async (value) => {
                    if (value) router.push('/accessibility-disclosure');
                  }}
                  trackColor={{
                    true: primaryColor,
                    false: color.border,
                  }}
                  thumbColor="#FFFFFF"
                  disabled={!permissions.contextAwareness}
                />
              }
            />
            <View
              style={[
                styles.contextAwarenessInfo,
                { backgroundColor: `${color.muted}0D` },
              ]}
            >
              <Text
                style={[styles.contextAwarenessText, { color: color.muted }]}
              >
                Context Awareness uses a battery-efficient Accessibility Service
                to seamlessly activate Ekwe when typing in messaging apps like
                WhatsApp.
              </Text>
            </View>
          </Card>

          <SectionHeader title="Languages" />
          <Card padding="none" overflow style={styles.cardSection}>
            <SettingsRow
              label="Edit Selection Grid"
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSheetVisible(true);
              }}
              value={
                <View style={styles.languageCountContainer}>
                  <Text
                    style={[styles.languageCountText, { color: color.muted }]}
                  >
                    {selectedLanguages.length}/5 active
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </View>
              }
            />
          </Card>

          <SectionHeader title="Account" />
          <Card padding="none" overflow style={styles.cardSection}>
            <Pressable
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                handleLogout();
              }}
              style={({ pressed }) => [
                styles.actionButton,
                { borderBottomColor: color.border },
                pressed && styles.actionButtonPressed,
              ]}
            >
              <LogOut size={18} color={color.foreground} />
              <Text
                style={[styles.actionButtonText, { color: color.foreground }]}
              >
                Log out
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                handleDeleteAccount();
              }}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <LogOut size={18} color="#EF4444" />
              <Text style={[styles.actionButtonText, { color: '#EF4444' }]}>
                Delete Account
              </Text>
            </Pressable>
          </Card>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: color.muted }]}>
              Ekwe v{Constants.expoConfig?.version ?? '1.0.0'} (Build{' '}
              {Constants.expoConfig?.android?.versionCode ??
                Constants.expoConfig?.ios?.buildNumber ??
                '1'}
              )
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <LanguagePickerSheet
        isVisible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        selectedLanguages={selectedLanguages}
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={(sel: string[], pins: string[]) => {
          setSelectedLanguages(sel);
          setPinnedLanguages(pins);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  profileCardContainer: { paddingHorizontal: 16, marginTop: 8 },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 20 },
  avatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    borderWidth: 1,
  },
  avatarText: { fontFamily: 'Outfit-Medium', fontSize: 20 },
  profileInfo: { flex: 1 },
  profileName: { fontFamily: 'Outfit-Medium', fontSize: 20, marginBottom: 2 },
  profileEmail: { fontFamily: 'Outfit-Regular', fontSize: 14 },
  cardSection: { marginHorizontal: 16, marginBottom: 24 },
  contextAwarenessInfo: { paddingHorizontal: 20, paddingVertical: 16 },
  contextAwarenessText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 12,
    lineHeight: 20,
  },
  languageCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageCountText: { fontFamily: 'Outfit-Regular', fontSize: 14 },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionButtonPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  actionButtonText: { fontFamily: 'Outfit-Medium', fontSize: 16 },
  footer: {
    paddingBottom: 64,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  footerText: { fontFamily: 'Outfit-Regular', fontSize: 12 },
});
