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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── POST /auth/otp ──────────────────────────────────────────────
// Mirrors the worker's send-otp validation exactly (trim, lowercase,
// max length, shape regex, 2048-char token cap).
export const otpRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message: "INVALID_EMAIL" })
    .regex(EMAIL_RE, { message: "INVALID_EMAIL" }),
  turnstileToken: z
    .string()
    .max(2048, { message: "TURNSTILE_REQUIRED" })
    .optional(),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

// ─── POST /translate ─────────────────────────────────────────────
// Mirrors the worker's /translate request shape. Tier-aware semantics
// (text-length ceiling, auto-detect allowance, language-code allowlist)
// still live in the worker guards layered on top of this base shape.
export const translateRequestSchema = z.object({
  text: z.string(),
  targetLang: z.string(),
  sourceLang: z.string().optional(),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

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
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

// ─── POST /tts ───────────────────────────────────────────────────
// The TTS request shape. Language-code allowlisting and the text-length
// ceiling still live in the worker guards layered on top of this base shape.
// The response is binary audio, so there is no JSON response schema.
export const ttsRequestSchema = z.object({
  text: z.string().min(1),
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
  redirect_url: z.string().min(1).optional(),
  currency: z.string().min(3).max(3).optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

// ─── POST /billing/checkout response ─────────────────────────────
export const checkoutResponseSchema = z.object({
  checkout_url: z.string(),
  tx_ref: z.string(),
  amount: z.number(),
  currency: z.string(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

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
