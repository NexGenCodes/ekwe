// Augment the generated Env with a narrow index signature for key rotation + webhook env access.
// The indexed keys type is param-string so the cast at the call site is still required,
// but unknown-typed values force explicit narrowing instead of silently passing anything.
interface Env {
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
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
