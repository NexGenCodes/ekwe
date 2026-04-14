import {
  LucideShieldCheck,
  LucideBatteryCharging,
  LucideZap,
  LucideChevronLeft,
} from 'lucide-react-native';
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';

export interface AccessibilityDisclosureProps {
  onAgree: () => void;
  onDeny: () => void;
}

export const AccessibilityDisclosure: React.FC<
  AccessibilityDisclosureProps
> = ({ onAgree, onDeny }) => {
  const { isDark } = useTheme();
  const primaryColor = getColor('primary', isDark);

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      <View className="px-6 pt-4 pb-2 z-10">
        <TouchableOpacity
          onPress={onDeny}
          className="w-10 h-10 items-center justify-center rounded-full bg-muted/10 active:scale-95"
        >
          <LucideChevronLeft size={24} color={getColor('foreground', isDark)} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        <Animated.View
          entering={FadeInDown.duration(500).springify()}
          className="mt-4 mb-8"
        >
          <Text className="font-display text-[32px] text-foreground dark:text-foreground-dark tracking-tight leading-[38px]">
            Accessibility Service Disclosure
          </Text>
          <View className="mt-4 p-4 rounded-[16px] bg-primary/10 border border-primary/20">
            <Text className="font-display text-[15px] text-primary mb-1">
              Google Play Policy Requirement
            </Text>
            <Text className="font-body text-[14px] text-foreground dark:text-zinc-300 leading-6">
              This app uses the{' '}
              <Text className="font-display">AccessibilityService API</Text> to
              detect when you open messaging applications (like WhatsApp or
              Tinder). This allows Ekwe to automatically display the floating
              translation tool over your screen exactly when you need it.
            </Text>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(500).delay(100).springify()}
          className="gap-6 mb-32"
        >
          <View className="flex-row items-start gap-4">
            <View className="p-3 rounded-[16px] bg-primary/10">
              <LucideZap size={24} color={primaryColor} />
            </View>
            <View className="flex-1 pr-2">
              <Text className="font-display text-[16px] text-foreground dark:text-foreground-dark mb-1">
                Contextual App Detection
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark leading-5">
                We strictly monitor top-level window transitions to identify
                when a target messaging app is launched. We do NOT read your
                chat messages.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start gap-4">
            <View className="p-3 rounded-[16px] bg-green-500/10">
              <LucideBatteryCharging size={24} color="#22C55E" />
            </View>
            <View className="flex-1 pr-2">
              <Text className="font-display text-[16px] text-foreground dark:text-foreground-dark mb-1">
                Battery Optimized
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark leading-5">
                Utilizing native Accessibility signals prevents aggressive
                background polling, ensuring your phone's battery isn't drained.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start gap-4">
            <View className="p-3 rounded-[16px] bg-blue-500/10">
              <LucideShieldCheck size={24} color="#3B82F6" />
            </View>
            <View className="flex-1 pr-2">
              <Text className="font-display text-[16px] text-foreground dark:text-foreground-dark mb-1">
                Zero Data Collection
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark leading-5">
                We{' '}
                <Text className="font-display">
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
      <View className="absolute bottom-0 left-0 right-0 bg-background dark:bg-background-dark pt-4 pb-10 px-6 border-t border-border dark:border-zinc-800/80">
        <TouchableOpacity
          onPress={onAgree}
          style={{ backgroundColor: primaryColor }}
          className="w-full py-4 rounded-[16px] items-center active:scale-[0.98] transition-transform"
        >
          <Text className="text-white font-display text-[16px]">I Agree</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDeny}
          className="w-full py-4 mt-1 items-center active:bg-muted/5 rounded-[16px]"
        >
          <Text className="text-muted font-bodyMed text-[15px]">Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
