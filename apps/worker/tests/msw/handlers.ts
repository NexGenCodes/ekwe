import { http, HttpResponse } from "msw";

/**
 * Canonical outbound endpoints the worker reaches. Centralised so tests,
 * handlers, contract checks and fixture recording all reference the same
 * URLs (path matching ignores query strings).
 */
export const PROVIDER_URLS = {
  deepgram: "https://api.deepgram.com/v1/listen",
  gladiaUpload: "https://api.gladia.io/v2/upload",
  gladiaTranscription: "https://api.gladia.io/v2/pre-recorded",
  assemblyaiUpload: "https://api.assemblyai.com/v2/upload",
  assemblyaiTranscript: "https://api.assemblyai.com/v2/transcript",
  witaiDictation: "https://api.wit.ai/dictation",
  groqTranscriptions: "https://api.groq.com/openai/v1/audio/transcriptions",
  groqChat: "https://api.groq.com/openai/v1/chat/completions",
  cohereTranscriptions: "https://api.cohere.com/v2/audio/transcriptions",
  cohereChat: "https://api.cohere.ai/v2/chat",
  mistralChat: "https://api.mistral.ai/v1/chat/completions",
  geminiGenerate:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  openrouterChat: "https://openrouter.ai/api/v1/chat/completions",
  paystackInitialize: "https://api.paystack.co/transaction/initialize",
  frankfurterLatest: "https://api.frankfurter.app/latest",
  supabaseCheckPreflight: "https://mock.supabase.co/rest/v1/rpc/check_preflight",
  supabaseSetProStatus: "https://mock.supabase.co/rest/v1/rpc/set_pro_status",
} as const;

const notFound = () =>
  HttpResponse.json({ error: "not found" }, { status: 404 });

/**
 * Default handlers registered on the Node server at construction.
 * Every endpoint the worker may reach gets an explicit (failing) response so
 * tests are deterministic and `onUnhandledRequest: "error"` still catches any
 * URL we forgot about. Tests override individual endpoints with `server.use`.
 */
export const defaultHandlers = [
  // Transcribe providers
  http.post(PROVIDER_URLS.deepgram, notFound),
  http.post(PROVIDER_URLS.gladiaUpload, notFound),
  http.post(PROVIDER_URLS.gladiaTranscription, notFound),
  http.post(PROVIDER_URLS.assemblyaiUpload, notFound),
  http.post(PROVIDER_URLS.assemblyaiTranscript, notFound),
  http.post(PROVIDER_URLS.witaiDictation, notFound),
  http.post(PROVIDER_URLS.groqTranscriptions, notFound),
  http.post(PROVIDER_URLS.cohereTranscriptions, notFound),
  // Translate providers
  http.post(PROVIDER_URLS.groqChat, notFound),
  http.post(PROVIDER_URLS.cohereChat, notFound),
  http.post(PROVIDER_URLS.mistralChat, notFound),
  http.post(PROVIDER_URLS.geminiGenerate, notFound),
  http.post(PROVIDER_URLS.openrouterChat, notFound),
  // Backend services
  http.get(PROVIDER_URLS.frankfurterLatest, notFound),
  http.post(PROVIDER_URLS.paystackInitialize, notFound),
  http.post(PROVIDER_URLS.supabaseCheckPreflight, notFound),
  http.post(PROVIDER_URLS.supabaseSetProStatus, notFound),
];
