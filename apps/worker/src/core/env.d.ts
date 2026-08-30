// Augment the generated Env with secrets and provider-key index signatures.
// Secrets (Worker secrets set via `wrangler secret put`) are NOT in the
// auto-generated worker-configuration.d.ts, so they need manual declaration.
// Bindings like EKWE_D1, TURNSTILE_SECRET, and TURNSTILE_HOSTNAMES are
// already non-optional in worker-configuration.d.ts — do NOT re-declare them
// here as optional, because interface merging will widen the type to
// `T | undefined` and break non-null usage downstream.
interface Env {
  // Secrets set via `wrangler secret put` that are not compile-time vars in
  // wrangler.jsonc (so absent from the generated types). Declared manually.
  TURNSTILE_SECRET: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Opaque `sb_secret_...` API key. When set, the OTP route sends this on the
  // `apikey` header plus the end-user IP in `Sb-Forwarded-For` so Supabase Auth
  // rate-limits each client's real IP instead of the worker's egress IP.
  SUPABASE_SECRET_KEY?: string;
  SENTRY_DSN?: string;
  PUSH_NOTIFY_SECRET?: string;
  FLUTTERWAVE_SECRET?: string;
  FLUTTERWAVE_PUBLIC?: string;
  FLUTTERWAVE_WEBHOOK_SECRET?: string;
  [key: `COHERE_KEY_${number}`]: string | undefined;
  [key: `DEEPGRAM_KEY_${number}`]: string | undefined;
  [key: `GEMINI_KEY_${number}`]: string | undefined;
  [key: `GLADIA_KEY_${number}`]: string | undefined;
  [key: `GROQ_KEY_${number}`]: string | undefined;
  [key: `MISTRAL_KEY_${number}`]: string | undefined;
  [key: `WIT_KEY_${number}`]: string | undefined;
  [key: `WIT_KEY_${string}`]: string | undefined;
  [key: string]: unknown;
}
