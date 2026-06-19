import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import { Mail, Star, Shield, FileText } from "lucide-react-native";
import React from "react";
import { Linking } from "react-native";

import { ProfileRow } from "../ProfileRow";
import { AnimatedSection } from "./AnimatedSection";

import { CONTACT_EMAIL } from "@/constants";
import { useTheme } from "@/hooks";
import { AppAlert } from "@/utils/alert";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { triggerHaptic } from "@/utils/haptics";
import logger from "@/utils/logger";
import { isIOS } from "@/utils/platform";

export function HelpSection(): React.JSX.Element {
  const { color } = useTheme();
  const router = useRouter();

  const handleRateUs = async (): Promise<void> => {
    await triggerHaptic();

    track(AnalyticsEvents.RATE_PROMPT_SHOWN);

    try {
      if (await StoreReview.hasAction()) {
        await StoreReview.requestReview();
        track(AnalyticsEvents.RATE_PROMPT_RATED, { method: "native" });
      }
    } catch {
      logger.warn("StoreReview request failed, opening store link instead");
    }

    const url: string | null = isIOS
      ? ((): string | null => {
          const id = process.env.EXPO_PUBLIC_ITUNES_ITEM_ID || "";
          if (!id || id === "123456789") {
            AppAlert.info(
              "Not Configured",
              "Set EXPO_PUBLIC_ITUNES_ITEM_ID in your .env file to enable App Store reviews.",
            );
            return null;
          }
          return `itms-apps://itunes.apple.com/app/viewContentsUserReviews?id=${id}&action=write-review`;
        })()
      : ((): string | null => {
          const pkg = Constants.expoConfig?.android?.package;
          if (!pkg) {
            AppAlert.error("Error", "Could not determine app package name.");
            return null;
          }
          return `market://details?id=${pkg}`;
        })();
    if (!url) return;

    Linking.openURL(url)
      .then(() => {
        track(AnalyticsEvents.RATE_PROMPT_RATED, { method: "store_link" });
      })
      .catch(() => {
        AppAlert.error("Error", "Could not open the app store.");
      });
  };

  return (
    <AnimatedSection delay={250} title="Help & Legal">
      <ProfileRow
        icon={Mail}
        sfIcon="envelope.fill"
        iconColor={color.foreground}
        title="Contact Support"
        subtitle={CONTACT_EMAIL}
        hasDivider
        onPress={async () => {
          await triggerHaptic();
          Linking.openURL(`mailto:${CONTACT_EMAIL}`);
        }}
      />
      <ProfileRow
        icon={Star}
        sfIcon="star.fill"
        iconColor={color.foreground}
        title="Rate Us"
        hasDivider
        onPress={handleRateUs}
      />
      <ProfileRow
        icon={Shield}
        sfIcon="shield.fill"
        iconColor={color.foreground}
        title="Privacy Policy"
        hasDivider
        onPress={async () => {
          await triggerHaptic();
          router.push("/legal/privacy");
        }}
      />
      <ProfileRow
        icon={FileText}
        sfIcon="doc.text.fill"
        iconColor={color.foreground}
        title="Terms of Service"
        onPress={async () => {
          await triggerHaptic();
          router.push("/legal/terms");
        }}
      />
    </AnimatedSection>
  );
}
