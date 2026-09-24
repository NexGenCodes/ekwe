import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { Echo } from "@/components/features/Echo";
import { logger } from "@/utils";

export default function ShareScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    uri?: string;
    mimeType?: string;
    sourceApp?: string;
  }>();
  const mountedAt = useRef(Date.now());

  const close = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next): void => {
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
