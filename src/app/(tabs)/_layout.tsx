import { Tabs } from 'expo-router';
import { Home, History, User, Settings } from 'lucide-react-native';
import React from 'react';

import { useTheme } from '@/hooks';

export default function TabLayout(): React.ReactElement {
  const { color } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerTransparent: false,
        headerStyle: {
          backgroundColor: color.background,
        },
        headerShadowVisible: false,
        headerTitleStyle: {
          fontFamily: 'Outfit-Bold',
          color: color.foreground,
        },
        headerTintColor: color.primary,
        tabBarStyle: {
          backgroundColor: color.card,
          borderTopColor: color.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        tabBarLabelStyle: {
          fontFamily: 'Outfit-Medium',
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <History size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: true,
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
