import { useSelector } from '@legendapp/state/react';
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

import { Button } from '@/components/ui';
import { useLogout, useTheme } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function ProfileScreen(): React.JSX.Element {
  const user = useSelector(() => auth$.user.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const router = useRouter();
  const { color } = useTheme();
  const { confirmLogout } = useLogout();

  const primaryColor = color.primary;
  const mutedColor = color.muted;

  const userTier = isPro ? 'pro' : 'free';
  const rawName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const userEmail = user?.email;
  const userName =
    rawName || (userEmail ? userEmail.split('@')[0] : 'Ekwe User');

  const handleLogout = confirmLogout;

  const renderInfoRow = (
    icon: React.ReactNode,
    label: string,
    value: string,
  ): React.ReactElement => (
    <View className="flex-row items-center py-4 border-b border-border dark:border-border">
      <View className="w-10 h-10 rounded-full bg-card dark:bg-card items-center justify-center mr-4">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-xs font-body text-muted dark:text-muted uppercase tracking-widest mb-0.5">
          {label}
        </Text>
        <Text className="text-base font-bodyMed text-foreground dark:text-zinc-100">
          {value}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 py-4 flex-row items-center justify-between border-b border-border dark:border-border">
        <Pressable
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          hitSlop={8}
          className="w-10 h-10 items-center justify-center rounded-full active:bg-card dark:active:bg-card active:scale-95 transition-all duration-200"
        >
          <ChevronLeft size={24} color={color.foreground} />
        </Pressable>
        <Text className="font-display text-xl text-foreground dark:text-foreground">
          Profile
        </Text>
        <Pressable
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/(tabs)/settings');
          }}
          hitSlop={8}
          className="w-10 h-10 items-center justify-center rounded-full active:bg-card dark:active:bg-card active:scale-95 transition-all duration-200"
        >
          <Settings size={22} color={color.foreground} />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View className="items-center py-10">
          <View className="w-24 h-24 rounded-full border-4 border-card dark:border-card shadow-sm overflow-hidden mb-4">
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
          <Text className="text-2xl font-display text-foreground dark:text-foreground">
            {userName}
          </Text>
          <View className="flex-row items-center mt-2 px-3 py-1 rounded-full bg-primary/10 dark:bg-primary/20 border border-primary/20">
            <Crown size={14} color={primaryColor} />
            <Text className="ml-1.5 text-xs font-bodyMed text-primary dark:text-primary uppercase tracking-wider">
              {userTier === 'pro' ? 'Pro Member' : 'Free Plan'}
            </Text>
          </View>
        </View>

        {/* Account Details */}
        <View className="mb-8">
          <Text className="text-xs font-bodyMed text-muted dark:text-muted uppercase tracking-[0.2em] mb-4">
            Account Details
          </Text>
          <View className="bg-card dark:bg-card rounded-[24px] px-5 border border-border dark:border-border overflow-hidden">
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
          <Text className="text-xs font-bodyMed text-muted dark:text-muted uppercase tracking-[0.2em] mb-4">
            Plan & Billing
          </Text>
          <Pressable
            className="bg-primary/5 dark:bg-primary/5 p-6 rounded-[24px] border border-primary/20 dark:border-primary/30 flex-row items-center justify-between active:scale-95 transition-all duration-200"
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              AppAlert.info('Billing', 'Subscription management coming soon.');
            }}
          >
            <View className="flex-row items-center">
              <CreditCard size={24} color={primaryColor} />
              <View className="ml-4">
                <Text className="text-lg font-bodyMed text-foreground dark:text-foreground">
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
          <Button
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
