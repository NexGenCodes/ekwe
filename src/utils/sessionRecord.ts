import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'ekwe-sessions' });
const SESSION_KEY = 'interrupted_session';

export interface InterruptedSession {
  sessionId: string;
  transcript: string;
  sourceLang: string;
  targetLang: string;
  startTime: number;
}

export const SessionRecord = {
  save: (session: InterruptedSession): void => {
    storage.set(SESSION_KEY, JSON.stringify(session));
  },
  get: (): InterruptedSession | null => {
    const raw = storage.getString(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InterruptedSession;
    } catch {
      return null;
    }
  },
  clear: (): void => {
    storage.remove(SESSION_KEY);
  },
};
