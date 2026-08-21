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
  geminiTtsGenerate:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
  openrouterChat: "https://openrouter.ai/api/v1/chat/completions",
  openErApiLatest: "https://open.er-api.com/v6/latest/USD",
  supabaseCheckPreflight:
    "https://mock.supabase.co/rest/v1/rpc/check_preflight",
  supabaseCheckSessionActive:
    "https://mock.supabase.co/rest/v1/rpc/check_session_active",
  supabaseConsumeUsage: "https://mock.supabase.co/rest/v1/rpc/consume_usage",
  supabaseGetDailyUsage: "https://mock.supabase.co/rest/v1/rpc/get_daily_usage",
  supabaseSetProStatus: "https://mock.supabase.co/rest/v1/rpc/set_pro_status",
  supabaseSubscriptionConfig:
    "https://mock.supabase.co/rest/v1/subscription_config",
  supabasePaymentConfig: "https://mock.supabase.co/rest/v1/payment_config",
  supabaseUpsertPushToken:
    "https://mock.supabase.co/rest/v1/rpc/upsert_push_token",
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
  http.post(PROVIDER_URLS.geminiTtsGenerate, notFound),
  http.post(PROVIDER_URLS.openrouterChat, notFound),
  // Backend services
  http.get(PROVIDER_URLS.openErApiLatest, notFound),
  http.post(PROVIDER_URLS.supabaseCheckPreflight, notFound),
  http.post(PROVIDER_URLS.supabaseCheckSessionActive, () =>
    // Sessions are active by default; individual tests override with `false`.
    HttpResponse.json(true),
  ),
  http.post(PROVIDER_URLS.supabaseConsumeUsage, notFound),
  http.post(PROVIDER_URLS.supabaseGetDailyUsage, notFound),
  http.post(PROVIDER_URLS.supabaseSetProStatus, notFound),
  http.get(PROVIDER_URLS.supabaseSubscriptionConfig, notFound),
  http.get(PROVIDER_URLS.supabasePaymentConfig, notFound),
  http.post(PROVIDER_URLS.supabaseUpsertPushToken, notFound),
];
