import { useRouter } from 'expo-router';
import {
  LucideShieldCheck,
  LucideBatteryCharging,
  LucideZap,
  LucideChevronLeft,
} from 'lucide-react-native';
import EkweNative from 'modules/ekwe-native';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';

export default function AccessibilityDisclosureScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const primaryColor = getColor('primary', isDark);

  const handleAccept = async () => {
    await EkweNative.requestAccessibilityPermission();
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <View className="flex-1 px-6 pt-4">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center rounded-full bg-muted/10"
        >
          <LucideChevronLeft size={24} color={getColor('foreground', isDark)} />
        </TouchableOpacity>

        <View className="mt-8 mb-10">
          <Text className="font-heading text-3xl text-foreground dark:text-foreground-dark">
            Privacy & Efficiency
          </Text>
          <Text className="font-body text-muted dark:text-muted-dark mt-2 leading-6">
            Ekwe uses an Accessibility Service to provide a seamless and
            battery-efficient translation experience.
          </Text>
        </View>

        <View className="space-y-6">
          <View className="flex-row items-start space-x-4">
            <View className="p-3 rounded-2xl bg-primary/10">
              <LucideZap size={24} color={primaryColor} />
            </View>
            <View className="flex-1">
              <Text className="font-bodyMed text-base text-foreground dark:text-foreground-dark">
                App Detection
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark mt-1">
                Detects when you open WhatsApp or Tinder to automatically show
                the translation tools only when needed.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start space-x-4">
            <View className="p-3 rounded-2xl bg-green-500/10">
              <LucideBatteryCharging size={24} color="#22C55E" />
            </View>
            <View className="flex-1">
              <Text className="font-bodyMed text-base text-foreground dark:text-foreground-dark">
                Battery Optimized
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark mt-1">
                Uses event-driven system signals instead of polling,
                significantly reducing background CPU and battery drain.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start space-x-4">
            <View className="p-3 rounded-2xl bg-blue-500/10">
              <LucideShieldCheck size={24} color="#3B82F6" />
            </View>
            <View className="flex-1">
              <Text className="font-bodyMed text-base text-foreground dark:text-foreground-dark">
                No Data Collection
              </Text>
              <Text className="font-body text-sm text-muted dark:text-muted-dark mt-1">
                We do not collect, store, or share any data captured by this
                service. It is only used to trigger the floating UI.
              </Text>
            </View>
          </View>
        </View>

        <View className="absolute bottom-10 left-6 right-6">
          <TouchableOpacity
            onPress={handleAccept}
            style={{ backgroundColor: primaryColor }}
            className="w-full py-4 rounded-2xl items-center shadow-lg active:scale-95 transition-all"
          >
            <Text className="text-white font-bodyBold text-base">
              Enable in Settings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-full py-4 mt-2 items-center"
          >
            <Text className="text-muted font-bodyMed">Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
