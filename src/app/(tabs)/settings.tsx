import { useSelector } from '@legendapp/state/react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { LogOut, ChevronRight, UserCircle } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguagePickerSheet, ThemeToggler, SettingsRow } from '@/components';
import { Card, Badge, SectionHeader } from '@/components/ui';
import { useForegroundApp, useLogout, useTheme } from '@/hooks';
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
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-6 py-4 flex-row justify-between items-center">
        <Text className="font-display text-[28px] tracking-tight text-foreground dark:text-foreground-dark">
          Settings
        </Text>
      </View>

      <ScrollView
        className="flex-1 bg-background dark:bg-background-dark"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <Animated.View
          entering={FadeInUp.duration(600).springify()}
          className="px-4 mt-2"
        >
          <Card
            style={{ flexDirection: 'row', alignItems: 'center', padding: 20 }}
          >
            <View className="w-14 h-14 rounded-full bg-primary/10 items-center justify-center mr-4 border border-primary/20">
              <Text className="text-xl font-display text-primary">
                {rawName ? (
                  rawName[0].toUpperCase()
                ) : (
                  <UserCircle size={24} color={primaryColor} />
                )}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-display text-[17px] text-foreground dark:text-zinc-50 mb-0.5">
                {userName}
              </Text>
              <Text className="font-body text-[13px] text-muted dark:text-zinc-400">
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
          <Card padding="none" overflow style={{ marginHorizontal: 16 }}>
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
          <Card padding="none" overflow style={{ marginHorizontal: 16 }}>
            <SettingsRow
              label="Auto-copy to Clipboard"
              isLocked={userTier !== 'pro'}
              value={
                <Switch
                  value={userTier === 'pro' ? autoCopy : false}
                  onValueChange={(val) => {
                    setAutoCopy(val);
                  }}
                  trackColor={{
                    true: primaryColor,
                    false: color.border,
                  }}
                  thumbColor="#FFFFFF"
                  disabled={userTier !== 'pro'}
                />
              }
            />
            <SettingsRow
              label="App-Context Awareness"
              isLocked={userTier !== 'pro'}
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
                  disabled={userTier !== 'pro'}
                />
              }
            />
            <View className="px-5 py-4 bg-muted/5">
              <Text className="font-body text-[12px] text-muted dark:text-zinc-400 leading-5">
                Context Awareness uses a battery-efficient Accessibility Service
                to seamlessly activate Ekwe when typing in messaging apps like
                WhatsApp.
              </Text>
            </View>
          </Card>

          <SectionHeader title="Languages" />
          <Card padding="none" overflow style={{ marginHorizontal: 16 }}>
            <SettingsRow
              label="Edit Selection Grid"
              onPress={() => setSheetVisible(true)}
              value={
                <View className="flex-row items-center gap-2">
                  <Text className="font-body text-sm text-muted dark:text-zinc-400">
                    {selectedLanguages.length}/5 active
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </View>
              }
            />
          </Card>

          <SectionHeader title="Account" />
          <Card
            padding="none"
            overflow
            style={{ marginHorizontal: 16, marginBottom: 24 }}
          >
            <Pressable
              onPress={handleLogout}
              className="px-5 py-4 flex-row items-center gap-3 border-b border-border dark:border-zinc-800/60 active:bg-red-500/10 transition-colors"
            >
              <LogOut size={18} color={color.foreground} />
              <Text className="font-bodyMed text-[15px] text-foreground dark:text-zinc-100">
                Log out
              </Text>
            </Pressable>
            <Pressable
              onPress={handleDeleteAccount}
              className="px-5 py-4 flex-row items-center gap-3 active:bg-red-500/10 transition-colors"
            >
              <LogOut size={18} color="#EF4444" />
              <Text className="font-bodyMed text-[15px] text-red-500">
                Delete Account
              </Text>
            </Pressable>
          </Card>

          <View className="pb-16 items-center flex-row justify-center gap-2">
            <Text className="font-body text-[12px] text-muted dark:text-zinc-500">
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
    </SafeAreaView>
  );
}
