import { Image as ExpoImage } from "expo-image";
import { Clock } from "lucide-react-native";
import React from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { EmptyState, IconContainer } from "@/components";
import { Box } from "@/components/ui";
import { duration, spacing } from "@/constants";
import { borderRadius, iconSize } from "@/constants/sizes";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

interface HistoryEmptyStateProps {
  query: string;
}

export function HistoryEmptyState({
  query,
}: HistoryEmptyStateProps): React.JSX.Element {
  const { color } = useTheme();

  const styles = {
    emptyContainer: {
      flex: 1 as const,
      paddingHorizontal: spacing.xl,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingBottom: spacing["6xl"],
    },
    emptyCard: {
      width: "100%" as const,
      padding: spacing["2xl"],
      borderRadius: borderRadius["2xl"],
      alignItems: "center" as const,
      borderWidth: 1,
      borderStyle: "dashed" as const,
    },
  };

  return (
    <Animated.View
      entering={FadeIn.duration(duration.normal)}
      style={styles.emptyContainer}
    >
      <Box
        style={[
          styles.emptyCard,
          { backgroundColor: color.card, borderColor: color.border },
        ]}
      >
        <EmptyState
          animate
          icon={
            <IconContainer size="lg" backgroundColor={`${color.foreground}10`}>
              {isIOS ? (
                <ExpoImage
                  source="sf:clock.fill"
                  style={{ width: iconSize.lg, height: iconSize.lg }}
                  tintColor={color.foreground}
                />
              ) : (
                <Clock size={iconSize.lg} color={color.foreground} />
              )}
            </IconContainer>
          }
          title={query.length > 0 ? "No Matches Found" : "Silent Library"}
          subtitle={
            query.length > 0
              ? "We couldn't find any transcripts matching your search."
              : "Your voice note history will appear here."
          }
        />
      </Box>
    </Animated.View>
  );
}
