import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { CreditCard } from 'lucide-react-native';
import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { useTheme } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function BillingScreen(): React.ReactElement {
  const { color } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());
  const transactionsUsed = useSelector(() => auth$.transactionsUsed.get());
  const isFallback = useSelector(() => auth$.isFallback.get());

  const handleUpgrade = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    AppAlert.info(
      'Ekwe Pro',
      'Premium subscriptions are currently being rolled out. Check back soon for unlimited high-accuracy translations!',
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background"
    >
      <View className="px-6 pt-6 pb-4">
        <Text className="text-foreground dark:text-foreground font-display text-[32px] tracking-tight">
          Billing & Plans
        </Text>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {/* Current Plan Card */}
        <Card padding="lg" className="mb-6">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-foreground dark:text-foreground font-display text-xl">
              Current Plan
            </Text>
            <View
              style={{
                backgroundColor: isPro
                  ? `${color.primary}20`
                  : `${color.muted}20`,
              }}
              className="px-3 py-1 rounded-full"
            >
              <Text
                style={{ color: isPro ? color.primary : color.muted }}
                className="font-bodyMed text-xs uppercase tracking-wider"
              >
                {isPro ? 'Pro Tier' : 'Free Tier'}
              </Text>
            </View>
          </View>

          <Text className="text-muted dark:text-muted font-body text-base mb-6 leading-6">
            {isPro
              ? 'You have unlimited access to premium features, high-accuracy translation, and priority processing.'
              : 'You are currently on the free plan. Upgrade to unlock longer voice notes, higher accuracy, and premium features.'}
          </Text>

          {!isPro && (
            <Pressable
              onPress={handleUpgrade}
              style={{ backgroundColor: color.primary }}
              className="py-4 rounded-2xl items-center flex-row justify-center active:scale-95 transition-all duration-200"
            >
              <CreditCard
                size={20}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
              <Text className="text-white font-bodyMed text-base">
                Upgrade to Pro
              </Text>
            </Pressable>
          )}
        </Card>

        {/* Usage Card */}
        <Card padding="lg" className="mb-8">
          <Text className="text-foreground dark:text-foreground font-display text-xl mb-4">
            Current Usage
          </Text>

          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-muted dark:text-muted font-body text-base">
              Transactions
            </Text>
            <Text className="text-foreground dark:text-foreground font-bodyMed text-base">
              {isPro ? `${transactionsUsed} / 200` : transactionsUsed}
            </Text>
          </View>

          {isPro ? (
            <View className="h-2 rounded-full w-full overflow-hidden mb-4 bg-border dark:bg-border">
              <View
                style={{
                  backgroundColor: color.primary,
                  width: `${Math.min((transactionsUsed / 200) * 100, 100)}%`,
                }}
                className="h-full rounded-full"
              />
            </View>
          ) : (
            <View className="mb-4">
              <Text className="text-primary dark:text-primary font-bodyMed text-sm mt-1">
                Unlimited Plan (Free Tier)
              </Text>
            </View>
          )}

          {isFallback && (
            <View className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 mt-2">
              <Text className="text-orange-600 dark:text-orange-400 font-body text-sm text-center">
                Premium quota exceeded. Operating in Free Fallback mode.
              </Text>
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
