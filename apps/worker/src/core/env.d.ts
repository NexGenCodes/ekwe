interface Env {
  EMAIL?: { send(message: unknown): Promise<unknown> };

  JWT_PRIVATE_JWK: string;
  OTP_PEPPER: string;
  GOOGLE_CLIENT_IDS?: string;

  TURNSTILE_SECRET?: string;
  BREVO_API_KEY?: string;
  FIREBASE_PROJECT_NUMBER?: string;

  SENTRY_DSN?: string;
  UPDATE_NOTIFY_SECRET?: string;
  FLUTTERWAVE_SECRET?: string;
  FLUTTERWAVE_PUBLIC?: string;
  FLUTTERWAVE_WEBHOOK_SECRET?: string;
  EDGE_CLIENT_TOKEN?: string;
  SPEECH_URL_SECRET?: string;
  TTS_GEMINI_VOICE?: string;

  [key: `COHERE_KEY_${number}`]: string | undefined;
  [key: `DEEPGRAM_KEY_${number}`]: string | undefined;
  [key: `ELEVENLABS_KEY_${number}`]: string | undefined;
  [key: `GEMINI_KEY_${number}`]: string | undefined;
  [key: `GLADIA_KEY_${number}`]: string | undefined;
  [key: `GROQ_KEY_${number}`]: string | undefined;
  [key: `MISTRAL_KEY_${number}`]: string | undefined;
  [key: `OPENROUTER_KEY_${number}`]: string | undefined;
  [key: `ASSEMBLYAI_KEY_${number}`]: string | undefined;
  [key: `WIT_KEY_${number}`]: string | undefined;
  [key: `WIT_KEY_${string}`]: string | undefined;
  [key: string]: unknown;
}
