import { useSelector } from '@legendapp/state/react';
import { useRouter } from 'expo-router';
import { Settings, Clock, Activity, Zap } from 'lucide-react-native';
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweWordmark } from '@/assets/icons/EkweWordmark';
import { AccountAvatar } from '@/components';
import { Card, IconContainer } from '@/components/ui';
import { useTheme } from '@/hooks';
import { auth$, history$ } from '@/store';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const user = useSelector(() => auth$.user.get());
  const entries = useSelector(() => history$.entries.get());

  const totalTranslations = entries.filter((e) => !!e.translation).length;
  const totalSeconds = entries.reduce((acc, e) => acc + (e.duration || 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);

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
      {/* Header Bar */}
      <View className="h-[60px] flex-row items-center justify-between px-6 z-20">
        <EkweWordmark size={50} color={primaryColor} />
        <View className="flex-row items-center space-x-1">
          <AccountAvatar />
        </View>
      </View>

      <ScrollView
        className="flex-1 px-6 pt-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Section */}
        <View className="mb-8">
          <Text
            style={{ color: mutedColor }}
            className="font-body text-base mb-1"
          >
            Welcome back,
          </Text>
          <Text
            style={{ color: textColor }}
            className="font-display text-4xl tracking-tight leading-10"
          >
            {user?.user_metadata?.full_name?.split(' ')[0] || 'User'}
          </Text>
        </View>

        {/* Quick Stats Grid */}
        <View className="flex-row justify-between mb-8">
          <Card style={{ flex: 1, marginRight: 8, padding: 20 }}>
            <IconContainer style={{ marginBottom: 12 }}>
              <Activity size={20} color={primaryColor} />
            </IconContainer>
            <Text
              style={{ color: mutedColor }}
              className="font-body text-sm mb-1"
            >
              Translations
            </Text>
            <Text
              style={{ color: textColor }}
              className="font-display text-2xl"
            >
              {totalTranslations}
            </Text>
          </Card>

          <Card style={{ flex: 1, marginLeft: 8, padding: 20 }}>
            <IconContainer style={{ marginBottom: 12 }}>
              <Zap size={20} color={primaryColor} />
            </IconContainer>
            <Text
              style={{ color: mutedColor }}
              className="font-body text-sm mb-1"
            >
              Minutes Saved
            </Text>
            <Text
              style={{ color: textColor }}
              className="font-display text-2xl"
            >
              {totalMinutes}m
            </Text>
          </Card>
        </View>

        {/* Quick Actions */}
        <Text
          style={{ color: textColor }}
          className="font-display text-xl mb-4"
        >
          Quick Actions
        </Text>

        <View className="gap-y-4 mb-8">
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/history')}
            style={{ backgroundColor: cardColor, borderColor }}
            className="flex-row items-center p-4 rounded-2xl border"
            activeOpacity={0.7}
          >
            <IconContainer variant="muted" style={{ marginRight: 16 }}>
              <Clock size={20} color={textColor} />
            </IconContainer>
            <View className="flex-1">
              <Text
                style={{ color: textColor }}
                className="font-medium text-base mb-0.5"
              >
                Recent History
              </Text>
              <Text style={{ color: mutedColor }} className="font-body text-xs">
                View your past translations and notes
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/(tabs)/settings')}
            style={{ backgroundColor: cardColor, borderColor }}
            className="flex-row items-center p-4 rounded-2xl border"
            activeOpacity={0.7}
          >
            <IconContainer variant="muted" style={{ marginRight: 16 }}>
              <Settings size={20} color={textColor} />
            </IconContainer>
            <View className="flex-1">
              <Text
                style={{ color: textColor }}
                className="font-medium text-base mb-0.5"
              >
                App Settings
              </Text>
              <Text style={{ color: mutedColor }} className="font-body text-xs">
                Configure languages and preferences
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
