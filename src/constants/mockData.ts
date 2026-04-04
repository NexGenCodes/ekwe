import { HistoryEntry } from 'src/store/historySlice';

export const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: 'mock-001',
    sourceLang: 'es',
    targetLang: 'en',
    transcript:
      'Buenos días, ¿cómo estás? Espero que hayas dormido bien esta noche.',
    translation: 'Good morning, how are you? I hope you slept well last night.',
    timestamp: Date.now() - 300000,
    duration: 47,
    sourceApp: 'WhatsApp',
  },
  {
    id: 'mock-002',
    sourceLang: 'de',
    targetLang: 'en',
    transcript:
      'Ich wollte dir nur sagen dass ich dich vermisse und bald wieder sehen möchte.',
    translation:
      'I just wanted to tell you that I miss you and would like to see you again soon.',
    timestamp: Date.now() - 3600000,
    duration: 23,
    sourceApp: 'Telegram',
  },
  {
    id: 'mock-003',
    sourceLang: 'fr',
    targetLang: 'en',
    transcript: 'Bonjour, comment tu vas? Tu as passé une bonne journée?',
    translation: 'Hello, how are you? Did you have a good day?',
    timestamp: Date.now() - 86400000,
    duration: 18,
    sourceApp: null,
  },
  {
    id: 'mock-004',
    sourceLang: 'it',
    targetLang: 'en',
    transcript: 'Allora, ci vediamo domani alle cinque. Va bene?',
    translation: 'So, we will see each other tomorrow at five. Is that okay?',
    timestamp: Date.now() - 172800000,
    duration: 12,
    sourceApp: 'Instagram',
  },
];
