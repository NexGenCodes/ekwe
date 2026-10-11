import { http, HttpResponse } from "msw";

export const PROVIDER_URLS = {
  deepgram: "https://api.deepgram.com/v1/listen",
  gladiaUpload: "https://api.gladia.io/v2/upload",
  gladiaTranscription: "https://api.gladia.io/v2/pre-recorded",
  assemblyaiUpload: "https://api.assemblyai.com/v2/upload",
  assemblyaiTranscript: "https://api.assemblyai.com/v2/transcript",
  witaiDictation: "https://api.wit.ai/dictation",
  witaiLanguage: "https://api.wit.ai/language",
  groqTranscriptions: "https://api.groq.com/openai/v1/audio/transcriptions",
  groqChat: "https://api.groq.com/openai/v1/chat/completions",
  elevenlabsStt: "https://api.elevenlabs.io/v1/speech-to-text",
  elevenlabsTts: "https://api.elevenlabs.io/v1/text-to-speech/:voiceId",
  cohereTranscriptions: "https://api.cohere.com/v2/audio/transcriptions",
  cohereChat: "https://api.cohere.ai/v2/chat",
  mistralChat: "https://api.mistral.ai/v1/chat/completions",
  geminiGenerate:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  geminiTtsGenerate:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
  deepgramSpeak: "https://api.deepgram.com/v1/speak",
  witaiSynthesize: "https://api.wit.ai/synthesize",
  openrouterChat: "https://openrouter.ai/api/v1/chat/completions",
  openErApiLatest: "https://open.er-api.com/v6/latest/USD",
} as const;

const notFound = () =>
  HttpResponse.json({ error: "not found" }, { status: 404 });

export const defaultHandlers = [
  http.post(PROVIDER_URLS.deepgram, notFound),
  http.post(PROVIDER_URLS.deepgramSpeak, notFound),
  http.post(PROVIDER_URLS.witaiSynthesize, notFound),
  http.post(PROVIDER_URLS.gladiaUpload, notFound),
  http.post(PROVIDER_URLS.gladiaTranscription, notFound),
  http.post(PROVIDER_URLS.assemblyaiUpload, notFound),
  http.post(PROVIDER_URLS.assemblyaiTranscript, notFound),
  http.post(PROVIDER_URLS.witaiDictation, notFound),
  // Auto-detect's Wit fallback is optional: default to a reachable service with
  // no usable locale so unrelated tests never trip its circuit or hit the
  // unhandled-request guard.
  http.get(PROVIDER_URLS.witaiLanguage, () =>
    HttpResponse.json({ detected_locales: [] }),
  ),
  http.post(PROVIDER_URLS.groqTranscriptions, notFound),
  http.post(PROVIDER_URLS.elevenlabsStt, notFound),
  http.post(PROVIDER_URLS.elevenlabsTts, notFound),
  http.post(PROVIDER_URLS.cohereTranscriptions, notFound),
  http.post(PROVIDER_URLS.groqChat, notFound),
  http.post(PROVIDER_URLS.cohereChat, notFound),
  http.post(PROVIDER_URLS.mistralChat, notFound),
  http.post(PROVIDER_URLS.geminiGenerate, notFound),
  http.post(PROVIDER_URLS.geminiTtsGenerate, notFound),
  http.post(PROVIDER_URLS.openrouterChat, notFound),
  http.get(PROVIDER_URLS.openErApiLatest, notFound),
];
