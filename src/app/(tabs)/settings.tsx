import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Lock, LogOut, ChevronRight, UserCircle } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, View, Text, ScrollView, Switch, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguagePickerSheet, ThemeSelector } from '@/components';
import { getColor } from '@/constants/colors';
import { useForegroundApp } from '@/hooks/useForegroundApp';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import logger from '@/utils/logger';

export default function SettingsScreen(): React.JSX.Element {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);
  const router = useRouter();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);
  const { user, isPro } = useAuthStore();

  const {
    themePreference,
    autoCopy,
    hapticsEnabled,
    setAutoCopy,
    setHapticsEnabled,
    selectedLanguages,
    pinnedLanguages,
    setSelectedLanguages,
    setPinnedLanguages,
  } = useSettingsStore();

  const rawName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const userEmail = user?.email;
  const userName =
    rawName || (userEmail ? userEmail.split('@')[0] : 'Ekwe User');
  const userTier = isPro ? 'pro' : 'free';

  const { hasPermission } = useForegroundApp();

  const handleLogout = async (): Promise<void> => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      logger.warn('[Settings] Supabase signOut error:', e);
    }
    router.replace('/');
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

  const renderSectionHeader = (title: string): React.JSX.Element => (
    <Text className="font-display text-xs uppercase tracking-[0.15em] px-6 pt-8 pb-3 text-muted dark:text-zinc-500">
      {title}
    </Text>
  );

  const renderItem = (
    label: string,
    value: React.ReactNode,
    onPress?: () => void,
    isLocked: boolean = false,
  ): React.JSX.Element => (
    <Pressable
      onPress={() => {
        if (isLocked) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          // Show upgrade modal logic here in future
          return;
        }
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={!onPress && !isLocked}
      className={`flex-row items-center justify-between px-5 py-4 border-b bg-card dark:bg-card-dark border-border dark:border-zinc-800/60 ${
        onPress && !isLocked
          ? 'active:opacity-70 transition-opacity duration-200'
          : ''
      }`}
      style={{ opacity: isLocked ? 0.5 : 1 }}
    >
      <View className="flex-row items-center gap-2">
        <Text className="font-bodyMed text-[15px] text-foreground dark:text-zinc-100">
          {label}
        </Text>
        {isLocked && <Lock size={14} color={getColor('muted', isDark)} />}
      </View>
      {value}
    </Pressable>
  );

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
          {renderSectionHeader('Configuration')}
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
            {renderItem(
              'Haptic Feedback',
              <Switch
                value={hapticsEnabled}
                onValueChange={setHapticsEnabled}
                trackColor={{
                  true: primaryColor,
                  false: isDark ? '#3F3F46' : '#E4E4E7',
                }}
                thumbColor="#FFFFFF"
              />,
            )}
            {renderItem(
              'App Theme',
              <View className="flex-row items-center gap-2">
                <Text className="font-body text-sm text-muted dark:text-zinc-400 capitalize">
                  {themePreference}
                </Text>
                <ChevronRight size={16} color={getColor('muted', isDark)} />
              </View>,
              () => setThemeSheetVisible(true),
            )}
          </View>

          {renderSectionHeader('Smart Features')}
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
            {renderItem(
              'Auto-copy to Clipboard',
              <Switch
                value={userTier === 'pro' ? autoCopy : false}
                onValueChange={setAutoCopy}
                trackColor={{
                  true: primaryColor,
                  false: isDark ? '#3F3F46' : '#E4E4E7',
                }}
                thumbColor="#FFFFFF"
                disabled={userTier !== 'pro'}
              />,
              undefined,
              userTier !== 'pro',
            )}
            {renderItem(
              'App-Context Awareness',
              <Switch
                value={!!hasPermission}
                onValueChange={async (value) => {
                  if (value) router.push('/accessibility-disclosure');
                }}
                trackColor={{
                  true: primaryColor,
                  false: isDark ? '#3F3F46' : '#E4E4E7',
                }}
                thumbColor="#FFFFFF"
                disabled={userTier !== 'pro'}
              />,
              undefined,
              userTier !== 'pro',
            )}
            <View className="px-5 py-4 bg-muted/5">
              <Text className="font-body text-[12px] text-muted dark:text-zinc-400 leading-5">
                Context Awareness uses a battery-efficient Accessibility Service
                to seamlessly activate Ekwe when typing in messaging apps like
                WhatsApp.
              </Text>
            </View>
          </View>

          {renderSectionHeader('Languages')}
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm bg-card dark:bg-card-dark">
            {renderItem(
              'Edit Selection Grid',
              <View className="flex-row items-center gap-2">
                <Text className="font-body text-sm text-muted dark:text-zinc-400">
                  {selectedLanguages.length}/5 active
                </Text>
                <ChevronRight size={16} color={getColor('muted', isDark)} />
              </View>,
              () => setSheetVisible(true),
            )}
          </View>

          {renderSectionHeader('Account')}
          <View className="overflow-hidden rounded-[24px] mx-4 border border-border dark:border-zinc-800/80 shadow-sm mb-6 bg-card dark:bg-card-dark">
            <Pressable
              onPress={handleLogout}
              className="px-5 py-4 flex-row items-center gap-3 border-b border-border dark:border-zinc-800/60 active:bg-red-500/10 transition-colors"
            >
              <LogOut size={18} color={getColor('foreground', isDark)} />
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
      <ThemeSelector
        isVisible={themeSheetVisible}
        onClose={() => setThemeSheetVisible(false)}
      />
    </SafeAreaView>
  );
}
