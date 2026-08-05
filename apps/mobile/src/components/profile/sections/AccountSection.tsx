import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import CreditCard from "lucide-react-native/icons/credit-card";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React from "react";

import { ProfileRow } from "../ProfileRow";
import { AnimatedSection } from "./AnimatedSection";

import { Box, Text } from "@/components/ui";
import { borderRadius, spacing } from "@/constants";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";
import { triggerHaptic } from "@/utils/haptics";

interface AccountSectionProps {
  isPro: boolean;
}

export function AccountSection({
  isPro,
}: AccountSectionProps): React.JSX.Element {
  const { color } = useTheme();
  const router = useRouter();

  return (
    <AnimatedSection delay={100} title="Account & Subscription">
      <ProfileRow
        icon={CreditCard}
        sfIcon="creditcard.fill"
        iconColor={color.foreground}
        title={isPro ? "Ekwe Pro" : "Plan & Billing"}
        subtitle={
          isPro ? "Unlimited translations" : "Free Tier · Standard limits"
        }
        onPress={async () => {
          await triggerHaptic();
          router.push("/billing");
        }}
        trailing={
          isPro ? (
            isIOS ? (
              <ExpoImage
                source="sf:chevron.right"
                style={{ width: 14, height: 14 }}
                tintColor={color.muted}
              />
            ) : (
              <ChevronRight size={20} color={color.muted} />
            )
          ) : (
            <Box
              style={[
                {
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: borderRadius.md,
                },
                { backgroundColor: color.brand },
              ]}
            >
              <Text variant="caption" style={{ color: color.onBrand }}>
                Upgrade
              </Text>
            </Box>
          )
        }
      />
    </AnimatedSection>
  );
}
