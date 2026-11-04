import React from "react";
import { ScrollArea, Box } from "@/components/ui";
import { SkeletonBox } from "@/components/SkeletonBox";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTabBarTotalHeight } from "@/components/CustomTabBar";
import { useTheme } from "@/hooks";

export function ProfileSkeleton(): React.ReactElement {
  const { color } = useTheme();
  const tabBarHeight = useTabBarTotalHeight();

  return (
    <Box
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading profile"
      style={{ flex: 1, backgroundColor: color.background }}
    >
      <ScrollArea
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: tabBarHeight + spacing.xl,
          gap: spacing.xl,
        }}
      >
        {/* Profile Identity Skeleton */}
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.lg,
            marginBottom: spacing.md,
            marginTop: spacing.sm,
          }}
        >
          <SkeletonBox width={72} height={72} borderRadius={36} />
          <Box style={{ flex: 1, gap: spacing.sm }}>
            <SkeletonBox
              width={140}
              height={22}
              borderRadius={borderRadius.md}
            />
            <SkeletonBox
              width={190}
              height={14}
              borderRadius={borderRadius.sm}
            />
          </Box>
        </Box>

        {/* Section 1: Account & Subscription */}
        <Box style={{ gap: spacing.sm }}>
          <SkeletonBox width={140} height={12} borderRadius={borderRadius.sm} />
          <SkeletonBox
            width="100%"
            height={74}
            borderRadius={borderRadius["2xl"]}
          />
        </Box>

        {/* Section 2: Preferences */}
        <Box style={{ gap: spacing.sm }}>
          <SkeletonBox width={100} height={12} borderRadius={borderRadius.sm} />
          <SkeletonBox
            width="100%"
            height={210}
            borderRadius={borderRadius["2xl"]}
          />
        </Box>

        {/* Section 3: Help & Legal */}
        <Box style={{ gap: spacing.sm }}>
          <SkeletonBox width={90} height={12} borderRadius={borderRadius.sm} />
          <SkeletonBox
            width="100%"
            height={150}
            borderRadius={borderRadius["2xl"]}
          />
        </Box>
      </ScrollArea>
    </Box>
  );
}
