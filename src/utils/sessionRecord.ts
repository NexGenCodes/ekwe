import { Db } from '@/services/db';

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
    Db.setStore(SESSION_KEY, JSON.stringify(session));
  },
  get: (): InterruptedSession | null => {
    const raw = Db.getStore(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InterruptedSession;
    } catch {
      return null;
    }
  },
  clear: (): void => {
    Db.removeStore(SESSION_KEY);
  },
};
