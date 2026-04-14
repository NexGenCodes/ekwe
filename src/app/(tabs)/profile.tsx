import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  User,
  Mail,
  Shield,
  Crown,
  LogOut,
  ChevronLeft,
  Settings,
  CreditCard,
} from 'lucide-react-native';
import React from 'react';
import { View, Text, ScrollView, Image, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweButton } from '@/components/common/EkweButton';
import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import logger from '@/utils/logger';

export default function ProfileScreen(): React.JSX.Element {
  const { user, isPro } = useAuthStore();
  const router = useRouter();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';

  const primaryColor = getColor('primary', isDark);
  const mutedColor = getColor('muted', isDark);

  const userTier = isPro ? 'pro' : 'free';
  const rawName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const userEmail = user?.email;
  const userName =
    rawName || (userEmail ? userEmail.split('@')[0] : 'Ekwe User');

  const handleLogout = async (): Promise<void> => {
    Alert.alert('Log Out', 'Are you sure you want to log out of Ekwe?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async (): Promise<void> => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          try {
            await supabase.auth.signOut();
            router.replace('/');
          } catch (e) {
            logger.error('Logout error:', e);
          }
        },
      },
    ]);
  };

  const renderInfoRow = (
    icon: React.ReactNode,
    label: string,
    value: string,
  ): React.ReactElement => (
    <View className="flex-row items-center py-4 border-b border-border dark:border-zinc-800/60">
      <View className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center mr-4">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-xs font-body text-muted dark:text-zinc-500 uppercase tracking-widest mb-0.5">
          {label}
        </Text>
        <Text className="text-base font-bodyMed text-foreground dark:text-zinc-100">
          {value}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 py-4 flex-row items-center justify-between border-b border-border dark:border-zinc-800/40">
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center rounded-full active:bg-card dark:active:bg-card-dark"
        >
          <ChevronLeft size={24} color={getColor('foreground', isDark)} />
        </Pressable>
        <Text className="font-display text-xl text-foreground dark:text-foreground-dark">
          Profile
        </Text>
        <Pressable
          onPress={() => router.push('/(tabs)/settings')}
          className="w-10 h-10 items-center justify-center rounded-full active:bg-card dark:active:bg-card-dark"
        >
          <Settings size={22} color={getColor('foreground', isDark)} />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View className="items-center py-10">
          <View className="w-24 h-24 rounded-full border-4 border-card dark:border-card-dark shadow-sm overflow-hidden mb-4">
            {user?.user_metadata?.avatar_url ? (
              <Image
                source={{ uri: user.user_metadata.avatar_url }}
                className="w-full h-full"
              />
            ) : (
              <View className="w-full h-full bg-primary/10 items-center justify-center">
                <Text className="text-3xl font-display text-primary">
                  {rawName?.[0] || userName[0]?.toUpperCase() || 'U'}
                </Text>
              </View>
            )}
          </View>
          <Text className="text-2xl font-display text-foreground dark:text-foreground-dark">
            {userName}
          </Text>
          <View className="flex-row items-center mt-2 px-3 py-1 rounded-full bg-primary/10 dark:bg-primary-dark/20 border border-primary/20">
            <Crown size={14} color={primaryColor} />
            <Text className="ml-1.5 text-xs font-bodyMed text-primary dark:text-primary-dark uppercase tracking-wider">
              {userTier === 'pro' ? 'Pro Member' : 'Free Plan'}
            </Text>
          </View>
        </View>

        {/* Account Details */}
        <View className="mb-8">
          <Text className="text-xs font-bodyMed text-muted dark:text-zinc-500 uppercase tracking-[0.2em] mb-4">
            Account Details
          </Text>
          <View className="bg-card dark:bg-card-dark rounded-[24px] px-5 border border-border dark:border-zinc-800/60 overflow-hidden">
            {renderInfoRow(
              <User size={20} color={mutedColor} />,
              'Full Name',
              rawName || 'Not set',
            )}
            {renderInfoRow(
              <Mail size={20} color={mutedColor} />,
              'Email Address',
              userEmail || 'Not set',
            )}
            {renderInfoRow(
              <Shield size={20} color={mutedColor} />,
              'Account Type',
              userTier === 'pro' ? 'Premium' : 'Standard',
            )}
          </View>
        </View>

        {/* Subscription / Plan */}
        <View className="mb-8">
          <Text className="text-xs font-bodyMed text-muted dark:text-zinc-500 uppercase tracking-[0.2em] mb-4">
            Plan & Billing
          </Text>
          <Pressable
            className="bg-primary/5 dark:bg-primary-dark/5 p-6 rounded-[24px] border border-primary/20 dark:border-primary-dark/30 flex-row items-center justify-between"
            onPress={() =>
              Alert.alert('Billing', 'Subscription management coming soon.')
            }
          >
            <View className="flex-row items-center">
              <CreditCard size={24} color={primaryColor} />
              <View className="ml-4">
                <Text className="text-lg font-bodyMed text-foreground dark:text-foreground-dark">
                  {userTier === 'pro' ? 'Ekwe Pro' : 'Free Tier'}
                </Text>
                <Text className="text-sm font-body text-muted dark:text-zinc-500">
                  {userTier === 'pro'
                    ? 'Unlimited translations'
                    : 'Standard daily limits'}
                </Text>
              </View>
            </View>
            {userTier !== 'pro' && (
              <View className="bg-primary px-3 py-1.5 rounded-lg">
                <Text className="text-white text-xs font-bodyMed">Upgrade</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Logout Button */}
        <View className="pb-12">
          <EkweButton
            variant="ghost"
            size="large"
            label="Log Out"
            onPress={handleLogout}
            leftIcon={<LogOut size={20} color="#EF4444" />}
            labelStyle={{ color: '#EF4444' }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
