import { useSelector } from "@legendapp/state/react";
import { Tabs, useRouter } from "expo-router";
import Home from "lucide-react-native/icons/house";
import History from "lucide-react-native/icons/rotate-ccw-clock";
import User from "lucide-react-native/icons/user";
import React, { useEffect } from "react";

import { CustomTabBar } from "@/components/CustomTabBar";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";
import { settings$ } from "@/store";

export default function TabLayout(): React.ReactElement | null {
  const { color } = useTheme();
  const router = useRouter();

  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  useEffect(() => {
    if (!onboardingCompleted) {
      router.replace("/(onboarding)/welcome");
    }
  }, [onboardingCompleted, router]);

  if (!onboardingCompleted) return null;

  return (
    <>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerTransparent: false,
          headerStyle: {
            backgroundColor: color.background,
          },
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: typography.heading3.fontFamily,
            color: color.foreground,
          },
          headerTintColor: color.foreground,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            headerShown: false,
            tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <History size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            headerShown: true,
            tabBarIcon: ({ color, size }) => (
              <User size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
