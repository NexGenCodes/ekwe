import LogIn from "lucide-react-native/icons/log-in";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";

import { Echo } from "@/components/features/Echo/Echo";

import { IconContainer } from "@/components/IconContainer";
import { Sheet } from "@/components/ui/Sheet";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { initAuth } from "@/services/auth";
import { IntentService } from "@/services/intentService";
import { initializeMMKV, mmkv } from "@/services/mmkv";
import { auth$ } from "@/store";
import type { EchoProps } from "@/types/echo";
import logger from "@/utils/logger";

const SESSION_CACHE_KEY = "hasSession";

export const ShareGate = (props: EchoProps): React.ReactElement => {
  const { color } = useTheme();
  const [resolved, setResolved] = useState<
    "loading" | "signed-in" | "signed-out"
  >("loading");
  const loaderDismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        await initializeMMKV();
      } catch (err) {
        logger.error("[ShareGate] initializeMMKV failed", err);
      }
      if (cancelled) return;

      if (mmkv.getBoolean(SESSION_CACHE_KEY) === true) {
        setResolved("signed-in");
        initAuth().catch((err) => {
          logger.error("[ShareGate] background initAuth failed", err);
        });
        return;
      }

      try {
        await initAuth();
      } catch (err) {
        logger.error("[ShareGate] initAuth failed", err);
      }
      if (cancelled) return;
      setResolved(auth$.session.peek() ? "signed-in" : "signed-out");
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resolved === "loading" || loaderDismissedRef.current) return;
    loaderDismissedRef.current = true;
    IntentService.dismissNativeLoader();
  }, [resolved]);

  if (resolved === "loading") return <React.Fragment />;

  if (resolved === "signed-in") return <Echo {...props} />;

  const handleLogin = (): void => {
    Linking.openURL("ekwe://login").catch((err) => {
      logger.error("[ShareGate] Failed to open login deep link:", err);
    });

    IntentService.dismissEcho();
    props.onClose?.();
  };

  const handleClose = (): void => {
    IntentService.dismissEcho();
    props.onClose?.();
  };

  return (
    <Sheet visible onClose={handleClose} maxHeight="46%">
      <Box
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
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
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: borderRadius.sm,
                backgroundColor: color.brand,
              }}
            />
            <Text variant="bodySmall" style={{ color: color.muted }}>
              ECHO
            </Text>
          </Box>

          <Pressable
            feedback="opacity"
            onPress={handleClose}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel="Close Echo"
          >
            <IconContainer size="sm" variant="muted">
              <X size={16} color={color.foreground} />
            </IconContainer>
          </Pressable>
        </Box>

        <Box style={{ alignItems: "center" }}>
          <IconContainer
            size="xl"
            variant="primary"
            style={{ marginBottom: spacing.lg }}
          >
            <LogIn size={32} color={color.brand} />
          </IconContainer>

          <Text
            variant="heading3"
            style={{
              color: color.foreground,
              marginBottom: spacing.sm,
              textAlign: "center",
            }}
          >
            Sign in to use Echo
          </Text>
          <Text
            variant="bodySmall"
            style={{
              color: color.muted,
              textAlign: "center",
              marginBottom: spacing.lg,
            }}
          >
            Open the Ekwe app, sign in, then share this voice note again to
            transcribe it.
          </Text>

          <Pressable
            feedback="opacity"
            onPress={handleLogin}
            accessibilityLabel="Log in"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              borderRadius: borderRadius["2xl"],
              gap: spacing.sm,
              backgroundColor: color.brand,
            }}
          >
            <LogIn size={16} color={color.onBrand} />
            <Text variant="bodySmall" style={{ color: color.onBrand }}>
              Log In
            </Text>
          </Pressable>

          <Pressable
            feedback="opacity"
            onPress={handleClose}
            accessibilityLabel="Cancel"
            hitSlop={{ top: 8, bottom: 8 }}
            style={{
              marginTop: spacing.sm,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
            }}
          >
            <Text variant="bodySmall" style={{ color: color.muted }}>
              Cancel
            </Text>
          </Pressable>
        </Box>
      </Box>
    </Sheet>
  );
};
