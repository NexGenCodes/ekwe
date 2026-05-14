import { useSelector } from '@legendapp/state/react';
import { CreditCard } from 'lucide-react-native';
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks';
import { auth$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function BillingScreen(): React.ReactElement {
  const { color } = useTheme();
  const isPro = useSelector(() => auth$.isPro.get());
  const transactionsUsed = useSelector(() => auth$.transactionsUsed.get());
  const isFallback = useSelector(() => auth$.isFallback.get());

  const handleUpgrade = (): void => {
    AppAlert.info(
      'Ekwe Pro',
      'Premium subscriptions are currently being rolled out. Check back soon for unlimited high-accuracy translations!',
    );
  };

  const textColor = color.foreground;
  const mutedColor = color.muted;
  const cardColor = color.card;
  const borderColor = color.border;
  const primaryColor = color.primary;

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View className="px-6 pt-6 pb-4">
        <Text
          style={{ color: textColor }}
          className="font-display text-3xl tracking-tight"
        >
          Billing & Plans
        </Text>
      </View>

      <ScrollView className="flex-1 px-6">
        <View
          style={{ backgroundColor: cardColor, borderColor }}
          className="rounded-3xl p-6 border mb-6"
        >
          <View className="flex-row justify-between items-center mb-4">
            <Text style={{ color: textColor }} className="font-display text-xl">
              Current Plan
            </Text>
            <View
              style={{
                backgroundColor: isPro
                  ? primaryColor + '20'
                  : mutedColor + '20',
              }}
              className="px-3 py-1 rounded-full"
            >
              <Text
                style={{ color: isPro ? primaryColor : mutedColor }}
                className="font-medium text-xs uppercase tracking-wider"
              >
                {isPro ? 'Pro Tier' : 'Free Tier'}
              </Text>
            </View>
          </View>

          <Text
            style={{ color: mutedColor }}
            className="font-body text-base mb-6 leading-6"
          >
            {isPro
              ? 'You have unlimited access to premium features, high-accuracy translation, and priority processing.'
              : 'You are currently on the free plan. Upgrade to unlock longer voice notes, higher accuracy, and premium features.'}
          </Text>

          {!isPro && (
            <TouchableOpacity
              onPress={handleUpgrade}
              style={{ backgroundColor: primaryColor }}
              className="py-4 rounded-2xl items-center flex-row justify-center"
            >
              <CreditCard
                size={20}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
              <Text className="text-white font-medium text-base">
                Upgrade to Pro
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View
          style={{ backgroundColor: cardColor, borderColor }}
          className="rounded-3xl p-6 border mb-8"
        >
          <Text
            style={{ color: textColor }}
            className="font-display text-xl mb-4"
          >
            Current Usage
          </Text>

          <View className="flex-row justify-between items-center mb-2">
            <Text style={{ color: mutedColor }} className="font-body text-base">
              Transactions
            </Text>
            <Text
              style={{ color: textColor }}
              className="font-medium text-base"
            >
              {isPro ? `${transactionsUsed} / 200` : transactionsUsed}
            </Text>
          </View>

          {isPro ? (
            <View
              style={{ backgroundColor: borderColor }}
              className="h-2 rounded-full w-full overflow-hidden mb-4"
            >
              <View
                style={{
                  backgroundColor: primaryColor,
                  width: `${Math.min((transactionsUsed / 200) * 100, 100)}%`,
                }}
                className="h-full rounded-full"
              />
            </View>
          ) : (
            <View className="mb-4">
              <Text
                style={{ color: primaryColor }}
                className="font-bodyMed text-sm mt-1"
              >
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
