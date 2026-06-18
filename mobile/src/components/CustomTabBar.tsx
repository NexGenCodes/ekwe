import { Tabs } from "expo-router";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CustomTabBarItem } from "./CustomTabBarItem";

import { Box } from "@/components/ui";
import { shadows } from "@/constants";
import { zIndex } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

// Derive the tab bar props type from expo-router's Tabs component
// to avoid depending on @react-navigation/bottom-tabs directly.
type TabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>
>[0];
type TabRoute = TabBarProps["state"]["routes"][number];

export function CustomTabBar({
  state,
  descriptors,
  navigation,
}: TabBarProps): React.ReactElement {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Box
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: zIndex.sticky,
        flexDirection: "row",
        backgroundColor: color.card,
        borderTopWidth: 1,
        borderTopColor: color.border,
        paddingBottom: Math.max(insets.bottom, 16),
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.md,
        ...shadows.soft,
      }}
    >
      {state.routes.map((route: TabRoute, index: number) => {
        const { options } = descriptors[route.key];
        const label =
          options.tabBarLabel !== undefined
            ? options.tabBarLabel
            : options.title !== undefined
              ? options.title
              : route.name;

        const isFocused = state.index === index;

        const onPress = (): void => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = (): void => {
          navigation.emit({
            type: "tabLongPress",
            target: route.key,
          });
        };

        return (
          <CustomTabBarItem
            key={route.key}
            isFocused={isFocused}
            options={options}
            onPress={onPress}
            onLongPress={onLongPress}
            label={label as string}
          />
        );
      })}
    </Box>
  );
}
