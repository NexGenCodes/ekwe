import { useRouter } from "expo-router";
import { useState, useEffect, useCallback } from "react";

import { SessionRecord, InterruptedSession } from "@/utils/sessionRecord";
export const useAppStateRestoration = (): {
  interruptedSession: InterruptedSession | null;
  dismissInterrupted: () => void;
  retryInterrupted: () => void;
} => {
  const router = useRouter();
  const [interruptedSession, setInterruptedSession] =
    useState<InterruptedSession | null>(null);

  useEffect(() => {
    const session = SessionRecord.get();
    if (session) {
      setInterruptedSession(session);
    }
  }, []);

  const dismissInterrupted = useCallback((): void => {
    SessionRecord.clear();
    setInterruptedSession(null);
  }, []);

  const retryInterrupted = useCallback((): void => {
    if (!interruptedSession) return;

    const { sessionId, transcript, sourceLang, targetLang } =
      interruptedSession;

    SessionRecord.clear();
    setInterruptedSession(null);

    router.push({
      pathname: "/result",
      params: {
        sessionId,
        transcript,
        sourceLang,
        targetLang,
        isHistoryReplay: "false",
      },
    });
  }, [interruptedSession, router]);

  return {
    interruptedSession,
    dismissInterrupted,
    retryInterrupted,
  };
};
