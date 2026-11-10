import LogIn from "lucide-react-native/icons/log-in";
import Sparkles from "lucide-react-native/icons/sparkles";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Linking } from "react-native";

import { OrbPanel } from "@/components/orb/OrbPanel";
import { Sheet } from "@/components/ui/Sheet";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { initAuth } from "@/services/auth";
import { OrbService } from "@/services/orbService";
import { auth$ } from "@/store";
import logger from "@/utils/logger";

type GateState = "loading" | "premium" | "free" | "signed-out";

export const OrbGate = (): React.ReactElement => {
  const { color } = useTheme();
  const [resolved, setResolved] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        await initAuth();
      } catch (err) {
        logger.error("[OrbGate] initAuth failed", err);
      }
      if (cancelled) return;
      const session = auth$.session.peek();
      if (!session) {
        setResolved("signed-out");
      } else {
        setResolved(auth$.isPro.peek() ? "premium" : "free");
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (resolved === "loading") return <React.Fragment />;
  if (resolved === "premium") return <OrbPanel />;

  const isSignedOut = resolved === "signed-out";

  const handleAction = (): void => {
    const url = isSignedOut ? "ekwe://login" : "ekwe://billing";
    Linking.openURL(url).catch((err) => {
      logger.error("[OrbGate] Failed to open deep link:", err);
    });
  };

  const handleClose = (): void => {
    void OrbService.dismissPanel();
  };

  return (
    <Sheet visible onClose={handleClose} maxHeight="46%">
      <Box
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing["2xl"],
        }}
      >
        <Box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: spacing.lg,
            marginTop: spacing.sm,
          }}
        >
          <Text variant="heading3" style={{ color: color.foreground }}>
            Orb
          </Text>
          <Pressable
            onPress={handleClose}
            accessibilityLabel="Close Orb"
            accessibilityRole="button"
            hitSlop={12}
            style={({ pressed }) => [
              {
                width: 44,
                height: 44,
                borderRadius: borderRadius.full,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: color.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <X size={20} color={color.foreground} />
          </Pressable>
        </Box>
        <Text
          variant="body"
          style={{
            color: color.foreground,
            marginBottom: spacing.sm,
            fontWeight: "600",
          }}
        >
          {isSignedOut ? "Sign in to use Orb" : "Orb is a Premium feature"}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: color.muted, marginBottom: spacing.lg }}
        >
          {isSignedOut
            ? "Orb transcribes audio from other apps with your Premium account. Sign in to continue."
            : "Upgrade to Premium to transcribe audio from other apps with the floating Orb."}
        </Text>
        <Pressable
          onPress={handleAction}
          accessibilityLabel={isSignedOut ? "Sign in" : "See Premium plans"}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              minHeight: 48,
              paddingVertical: spacing.md,
              borderRadius: borderRadius["2xl"],
              backgroundColor: color.brand,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: spacing.sm,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {isSignedOut ? (
            <LogIn size={18} color={color.onBrand} />
          ) : (
            <Sparkles size={18} color={color.onBrand} />
          )}
          <Text
            variant="body"
            style={{ color: color.onBrand, fontWeight: "700" }}
          >
            {isSignedOut ? "Sign in" : "See plans"}
          </Text>
        </Pressable>
      </Box>
    </Sheet>
  );
};
