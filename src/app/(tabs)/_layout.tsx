import { Tabs } from 'expo-router';
import React from 'react';

import { HistoryIcon } from '@/assets/icons/HistoryIcon';
import { HomeIcon } from '@/assets/icons/HomeIcon';
import { SettingsIcon } from '@/assets/icons/SettingsIcon';
import { useTheme } from '@/hooks';

const TAB_BAR_HEIGHT = 64;

export default function TabLayout(): React.ReactElement {
  const { color } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: color.background,
          borderTopWidth: 0.2,
          borderTopColor: color.border,
          height: TAB_BAR_HEIGHT,
          paddingBottom: 12,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        tabBarLabelStyle: {
          fontFamily: 'Outfit-Regular',
          fontSize: 12,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <HomeIcon size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <HistoryIcon size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: 'Billing',
          tabBarIcon: ({ color, size }) => {
            // Let's use a standard icon from lucide-react-native if we don't have a custom one
            const { CreditCard } = require('lucide-react-native');
            return <CreditCard size={size} color={color} />;
          },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <SettingsIcon size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
