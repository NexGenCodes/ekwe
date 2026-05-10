import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Lock, LogOut, ChevronRight, UserCircle } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, View, Text, ScrollView, Switch, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LanguagePickerSheet,
  ThemeToggler,
  SettingsRow,
  SectionHeader,
} from '@/components';
import { useForegroundApp } from '@/hooks';
import { useLogout } from '@/hooks';
import { useTheme } from '@/hooks';
import { supabase } from '@/services/supabase';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import logger from '@/utils/logger';

export default function SettingsScreen(): React.JSX.Element {
  const [sheetVisible, setSheetVisible] = useState(false);
  const router = useRouter();
  const { color } = useTheme();
  const primaryColor = color.primary;
  const user = useAuthStore((s) => s.user);
  const isPro = useAuthStore((s) => s.isPro);
  const { logout } = useLogout();

  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);
  const targetLanguage = useSettingsStore((s) => s.targetLanguage);
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);
  const autoCopy = useSettingsStore((s) => s.autoCopy);
  const setAutoCopy = useSettingsStore((s) => s.setAutoCopy);
  const pinnedLanguages = useSettingsStore((s) => s.pinnedLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSelectedLanguages);
  const setPinnedLanguages = useSettingsStore((s) => s.setPinnedLanguages);

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
    Alert.alert(
      'Delete Account',
      'Are you sure you want to permanently delete your account and all associated data? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async (): Promise<void> => {
            try {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              // Call edge function to securely delete user or call RPC if available
              // For now, if no RPC, sign out. You should add RPC logic on the backend.
              await supabase.auth.signOut();
              router.replace('/');
              // Ideally here you make an authenticated call `await supabase.rpc('delete_user')` beforehand.
            } catch (e) {
              logger.error('Account deletion failed:', e);
            }
          },
        },
      ],
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
          <View className="rounded-[24px] border border-border dark:border-zinc-800/80 bg-card dark:bg-card-dark p-5 flex-row items-center shadow-sm">
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
            <View
              className={`px-3 py-1.5 rounded-full ${userTier === 'pro' ? 'bg-primary/20' : 'bg-muted/20'}`}
            >
              <Text
                className={`font-display text-[11px] uppercase tracking-wider ${userTier === 'pro' ? 'text-primary' : 'text-muted'}`}
              >
                {userTier === 'pro' ? 'Pro Plan' : 'Free Plan'}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(600).delay(100).springify()}
        >
          <SectionHeader title="Configuration" />
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
            <SettingsRow
              label="Haptic Feedback"
              value={
                <Switch
                  value={hapticsEnabled}
                  onValueChange={setHapticsEnabled}
                  trackColor={{
                    true: primaryColor,
                    false: color.border,
                  }}
                  thumbColor="#FFFFFF"
                />
              }
            />
            <SettingsRow
              label="App Theme"
              value={<ThemeToggler />}
            />
          </View>

          <SectionHeader title="Smart Features" />
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
            <SettingsRow
              label="Auto-copy to Clipboard"
              isLocked={userTier !== 'pro'}
              value={
                <Switch
                  value={userTier === 'pro' ? autoCopy : false}
                  onValueChange={setAutoCopy}
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
          </View>

          <SectionHeader title="Languages" />
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
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
          </View>

          <SectionHeader title="Account" />
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm mb-6 bg-card dark:bg-card-dark">
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
          </View>

          <View className="pb-16 items-center flex-row justify-center gap-2">
            <Text className="font-body text-[12px] text-muted dark:text-zinc-500">
              Ekwe v1.0.0 (Build 42)
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
