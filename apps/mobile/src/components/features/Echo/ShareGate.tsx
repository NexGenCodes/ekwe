import LogIn from "lucide-react-native/icons/log-in";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";

import { Echo } from "./Echo";

import { IconContainer } from "../../IconContainer";
import { Sheet } from "../../ui/Sheet";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { initAuth } from "@/services/auth";
import { IntentService } from "@/services/IntentService";
import { initializeMMKV, mmkv } from "@/services/mmkv";
import { auth$ } from "@/store";
import type { EchoProps } from "@/types/echo";
import logger from "@/utils/logger";

const SESSION_CACHE_KEY = "hasSession";

/**
 * ShareGate — signed-in gate for the native share surface.
 *
 * On Android the translucent ShareActivity hosts this root directly (no
 * router), so a logged-out user can't be navigated to a login screen. Instead
 * this gate resolves the session before any Echo UI mounts: signed-in users get
 * the full Echo flow unchanged, signed-out users get a minimal "Sign in to use
 * Echo" card. The shared audio is never copied by the app while signed out.
 *
 * The mmkv proxy is an in-memory stand-in until initializeMMKV() resolves, so
 * that MUST finish before any sync session read — otherwise every user looks
 * signed out. Once the encrypted store is ready, a CACHED session mounts Echo
 * IMMEDIATELY (initAuth() only runs in the background, restoring the original
 * zero-wait share flow for signed-in users); the full initAuth chain is
 * reserved for the genuinely signed-out case where the gate is needed.
 */
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

      // Fast path: a cached session means the user is signed in. Mount Echo at
      // once and let initAuth() (and Echo's own initAuth) refresh the token in
      // the background — the audio pipeline starts immediately.
      if (mmkv.getBoolean(SESSION_CACHE_KEY) === true) {
        setResolved("signed-in");
        initAuth().catch((err) => {
          logger.error("[ShareGate] background initAuth failed", err);
        });
        return;
      }

      // Slow path: no cached session — run the full auth init to be certain
      // before deciding (this is where the signed-out card is truthful).
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

  // Dismiss the native loading card exactly once the decision is made. When
  // signed in, the card is dismissed by Echo's own resolver on mount
  // (idempotent); when signed out, the card here stands in for the loader.
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
    // Close the overlay — the user signs in in the main app and re-shares.
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
