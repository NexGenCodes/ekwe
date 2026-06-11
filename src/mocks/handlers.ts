import { http, HttpResponse } from "msw";

const WORKER_URL = "http://localhost:8787";

export const handlers = [
  http.post(`${WORKER_URL}/translate`, () => {
    return HttpResponse.json({
      translation: "Bonjour le monde",
      transliteration: undefined,
      language: "fr",
      provider: "mistral",
      transaction: {
        transactions_used: 1,
        tier_active: "FREE",
        is_fallback: false,
      },
    });
  }),
  http.post(`${WORKER_URL}/transcribe`, () => {
    return HttpResponse.json({
      transcription: "Hello world",
      language: "en",
      provider: "deepgram",
      transaction: {
        transactions_used: 1,
        tier_active: "FREE",
        is_fallback: false,
      },
    });
  }),
];
