import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { Echo } from "@/components/features/Echo";
import { logger } from "@/utils";

/**
 * Share-entry point. On iOS the ShareExtension writes the shared audio into
 * the shared App Group container and launches the app via
 * `ekwe://share?uri=<file://...>`. On Android the native ShareActivity copies
 * the shared audio into private cache and launches the same deep link with
 * `mimeType`/`sourceApp` params. This route hosts the Echo sheet and pops
 * itself when Echo is dismissed (or the app is backgrounded, mirroring the
 * share flow finishing).
 */
export default function ShareScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    uri?: string;
    mimeType?: string;
    sourceApp?: string;
  }>();
  const mountedAt = useRef(Date.now());

  const close = useCallback((): void => {
    // On cold start via `ekwe://share?uri=...` this modal is the only screen,
    // so there is nothing to pop back to.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next): void => {
      // Ignore the initial launch transition (cold start via URL scheme can
      // briefly report "background" before becoming active).
      if (Date.now() - mountedAt.current < 1500) return;
      if (next === "background") {
        logger.info("[ShareRoute] App backgrounded, closing share route");
        close();
      }
    });
    return (): void => sub.remove();
  }, [close]);

  return (
    <Echo
      audioUri={params.uri}
      mimeType={params.mimeType || "audio/*"}
      sourceApp={params.sourceApp || "ios"}
      onClose={close}
    />
  );
}
