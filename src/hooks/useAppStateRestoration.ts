import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState, useEffect, useCallback } from 'react';
import { RootStackParams } from 'src/navigation/types';
import { SessionRecord, InterruptedSession } from 'src/utils/sessionRecord';

type Nav = NativeStackNavigationProp<RootStackParams>;

export const useAppStateRestoration = (): {
  interruptedSession: InterruptedSession | null;
  dismissInterrupted: () => void;
  retryInterrupted: () => void;
} => {
  const navigation = useNavigation<Nav>();
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

    navigation.navigate('Result', {
      sessionId,
      transcript,
      sourceLang,
      targetLang,
      isHistoryReplay: false,
    });
  }, [interruptedSession, navigation]);

  return {
    interruptedSession,
    dismissInterrupted,
    retryInterrupted,
  };
};
