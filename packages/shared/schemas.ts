/**
 * ─── Shared API Boundary Schemas ─────────────────────────────────
 *
 * The single source of truth for request/response shapes that cross the
 * worker↔mobile boundary. Both sides parse with the same zod schemas so a
 * drift between worker responses and mobile expectations fails loudly at
 * the edge instead of silently corrupting state.
 *
 * Provider webhook envelopes are intentionally NOT schema-ized here: they
 * are upstream-owned, security critical, and best validated inline where
 * their quirks are documented.
 */
import { z } from "zod";
import { PRO_PRODUCT_IDS } from "./plans";
import { LANGUAGES } from "./languages";
import { FLUTTERWAVE_CURRENCIES } from "./money";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Language-code tuples for z.enum, derived from the shared allowlist so the
// worker's VALID_LANG_CODES (guards.ts) and the wire schemas can never drift.
const LANG_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];
const SOURCE_LANG_CODES = ["auto", ...LANG_CODES] as [string, ...string[]];

// ─── Auth email field (single source) ────────────────────────────
// One rule set for every auth email crossing the boundary: trim, lowercase,
// RFC 5321 max length, shape regex. Callers pass their own message — machine
// error codes on the wire, user-facing text in forms — but acceptance is
// identical by construction.
const authEmailField = (message: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message })
    .regex(EMAIL_RE, { message });

// ─── POST /auth/otp ──────────────────────────────────────────────
// Mirrors the worker's send-otp validation exactly (trim, lowercase,
// max length, shape regex, 2048-char token cap).
export const otpRequestSchema = z.object({
  email: authEmailField("INVALID_EMAIL"),
  turnstileToken: z
    .string()
    .max(2048, { message: "TURNSTILE_INVALID" })
    .optional(),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

// ─── Auth form schemas ───────────────────────────────────────────
// Client-side form validation for the auth flow, shared so mobile and any
// future client validate identically before hitting the worker. Messages are
// user-facing (forms render them verbatim). The email rules come from
// `authEmailField`, so a value the login form accepts is byte-for-byte what
// the worker's `otpRequestSchema` accepts; `token` is the same 6-digit code
// Supabase issues for verification.
export const loginSchema = z.object({
  email: authEmailField("Please enter a valid email address."),
});
export const otpSchema = z.object({
  token: z.string().length(6, "Please enter the 6-digit code."),
});
// The login form captures exactly the email half of an OTP request — derive
// the type from the wire shape so a rename upstream breaks here first.
export type LoginForm = Pick<OtpRequest, "email">;
export type OtpForm = z.infer<typeof otpSchema>;

// ─── POST /translate ─────────────────────────────────────────────
// Mirrors the worker's /translate request shape. Tier-aware semantics
// (text-length ceiling, auto-detect allowance, language-code allowlist)
// still live in the worker guards layered on top of this base shape.
export const translateRequestSchema = z.object({
  text: z.string().max(10_000),
  targetLang: z.enum(LANG_CODES),
  sourceLang: z.enum(SOURCE_LANG_CODES).optional(),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

// ─── Translation form schema ─────────────────────────────────────
// Client-side pre-flight guard derived from the wire shape above (extend, so
// wire fields can never silently vanish from the form): non-empty text,
// concrete language selections (no "none" placeholder), and the auto-detect
// exception to the same-language rule. Messages are user-facing — toasts
// render them verbatim.
export const translationSchema = translateRequestSchema
  .extend({
    text: z.string().min(1, "Please enter text to translate."),
    sourceLang: z
      .string()
      .min(1, "Please select a source language.")
      .refine((val) => val !== "none" && val !== "", {
        message: "Please select a source language.",
      }),
    targetLang: z
      .string()
      .min(1, "Please select a target language.")
      .refine((val) => val !== "none" && val !== "", {
        message: "Please select a target language.",
      }),
  })
  .refine(
    (data) => data.sourceLang === "auto" || data.sourceLang !== data.targetLang,
    {
      message: "Source and target languages cannot be the same.",
      path: ["targetLang"],
    },
  );
export type TranslationForm = z.infer<typeof translationSchema>;

// ─── POST /translate response ────────────────────────────────────
// `transliteration`/`language` are premium-only extras the worker may include;
// clients must not fail when they are absent. `provider` is always present:
// every provider reports its name and the worker would fail the request
// otherwise.
export const translateResponseSchema = z.object({
  translation: z.string(),
  transliteration: z.string().optional(),
  language: z.string().optional(),
  provider: z.string(),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;

// ─── POST /transcribe response ───────────────────────────────────
export const transcribeResponseSchema = z.object({
  text: z.string(),
  // Audio length in seconds. Only some providers report it (Deepgram,
  // AssemblyAI); clients treat it as advisory.
  duration: z.number().optional(),
  language: z.string().optional(),
  provider: z.string(),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

// ─── GET /pricing ─────────────────────────────────────────────────
// The store-ready pricing endpoint. Mobile sends its auto-detected country
// and gets back the local prices to show for both billing periods: the
// discounted monthly amount, the discounted annual amount (monthly × 12 with
// the annual discount applied on top), and the display-only discount
// metadata. The store still charges the product's USD list price — these
// discounts are a UI concern only (real discounts are Play/App Store
// offers/promo codes).
//
// Promo-code ready: a future promo-code lookup resolves into `discountPercent`
// exactly like the config discount does today, so the client already renders
// the strikethrough `originalPriceUsd`/`originalAnnualUsd` correctly.
export const storePricingResponseSchema = z.object({
  currency: z.string(),
  // Monthly — discounted local amount, then discounted USD.
  price: z.number(),
  usd: z.number(),
  originalPriceUsd: z.number(),
  /** Applied monthly discount % (config `discount_percent`, 0..100). */
  discountPercent: z.number(),
  // Annual — discounted local amount, then discounted USD.
  annualPrice: z.number(),
  annualUsd: z.number(),
  /** Pre-discount annual USD (monthly list price × 12). */
  originalAnnualUsd: z.number(),
  /** Effective % saved by annual vs 12 × discounted monthly (0..100). */
  annualDiscountPercent: z.number(),
});
export type StorePricingResponse = z.infer<typeof storePricingResponseSchema>;

// ─── GET /usage ──────────────────────────────────────────────────
export const usageSnapshotSchema = z.object({
  day: z.string(),
  resetsAt: z.number(),
  translate: z.object({
    used: z.number(),
    total: z.number(),
    remaining: z.number(),
  }),
  transcribe: z.object({
    used: z.number(),
    total: z.number(),
    remaining: z.number(),
  }),
  tts: z.object({
    used: z.number(),
    total: z.number(),
    remaining: z.number(),
  }),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

// ─── POST /tts ───────────────────────────────────────────────────
// The TTS request shape. Language-code allowlisting and the text-length
// ceiling still live in the worker guards layered on top of this base shape.
// The response is binary audio, so there is no JSON response schema.
export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
  lang: z.string().min(1),
  gender: z.enum(["male", "female"]).optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

// ─── POST /billing/checkout ──────────────────────────────────────
// `plan` is bound to the shared product IDs so the client and the Flutterwave
// webhook can never drift apart. `currency` is optional and defaults to USD
// server-side.
export const checkoutRequestSchema = z.object({
  plan: z.enum([PRO_PRODUCT_IDS.monthly, PRO_PRODUCT_IDS.annual]),
  // ISO-4217 alpha-3, shape-only: unsupported codes resolve to USD server-side
  // (the worker's resolvePaymentCurrency is the billable-set source of truth).
  currency: z
    .string()
    .min(3)
    .max(3)
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

// ─── POST /billing/checkout response ─────────────────────────────
// The worker authorizes a checkout session (server-authoritative pricing +
// unique tx_ref); the SDK initializes the actual payment client-side using
// the server-provided public key. There is no checkout_url anymore.
export const checkoutResponseSchema = z.object({
  tx_ref: z.string(),
  amount: z.number(),
  currency: z.enum(FLUTTERWAVE_CURRENCIES),
  public_key: z.string(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

// ─── POST /billing/verify-transaction ────────────────────────────
export const verifyTransactionRequestSchema = z.object({
  transaction_id: z.number().int().positive(),
});
export type VerifyTransactionRequest = z.infer<
  typeof verifyTransactionRequestSchema
>;

export const verifyTransactionResponseSchema = z.object({
  ok: z.literal(true),
  permanent: z.boolean(),
  transaction_id: z.number(),
  tx_ref: z.string(),
});
export type VerifyTransactionResponse = z.infer<
  typeof verifyTransactionResponseSchema
>;

// ─── GET /billing/flags ──────────────────────────────────────────
export const billingFlagsResponseSchema = z.object({
  flutterwave_enabled: z.boolean(),
  default_provider: z.string(),
});
export type BillingFlagsResponse = z.infer<typeof billingFlagsResponseSchema>;

// ─── POST /push-tokens ───────────────────────────────────────────
// Called at app launch before sign-in, so it is unauthenticated. The
// `ExponentPushToken[...]` prefix is enforced here as the contract (tokens are
// opaque Expo tokens); the worker surfaces it as INVALID_BODY.
export const registerPushTokenRequestSchema = z.object({
  push_token: z.string().startsWith("ExponentPushToken["),
  platform: z.enum(["ios", "android"]),
  app_version: z.string().optional(),
});
export type RegisterPushTokenRequest = z.infer<
  typeof registerPushTokenRequestSchema
>;
