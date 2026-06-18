import { http, HttpResponse } from "msw";

const WORKER_URL = "http://localhost:8787";

export const handlers = [
  http.post(`${WORKER_URL}/translate`, () => {
    return HttpResponse.json({
      translation: "Bonjour le monde",
      transliteration: undefined,
      language: "fr",
      provider: "mistral",
    });
  }),
  http.post(`${WORKER_URL}/transcribe`, () => {
    return HttpResponse.json({
      text: "Hello world",
      language: "en",
      provider: "deepgram",
    });
  }),
];
