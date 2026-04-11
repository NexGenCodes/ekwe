import { Tabs } from 'expo-router';
import { useColorScheme } from 'nativewind';
import React from 'react';

import { HistoryIcon } from '@/assets/icons/HistoryIcon';
import { HomeIcon } from '@/assets/icons/HomeIcon';
import { SettingsIcon } from '@/assets/icons/SettingsIcon';
import { getColor } from '@/constants/colors';

const TAB_BAR_HEIGHT = 64;

export default function TabLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: getColor('background', isDark),
          borderTopWidth: 0.2,
          borderTopColor: getColor('border', isDark),
          height: TAB_BAR_HEIGHT,
          paddingBottom: 12,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: getColor('primary', isDark),
        tabBarInactiveTintColor: getColor('muted', isDark),
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
