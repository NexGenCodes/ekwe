import { z } from "zod";
import { USAGE_METER_IDS } from "./usageMeters";
import { PRO_PRODUCT_IDS } from "./plans";
import { LANGUAGES } from "./languages";
import { FLUTTERWAVE_CURRENCIES } from "./money";
import { VOICE_SLOT_IDS } from "./voices";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LANG_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];
const SOURCE_LANG_CODES = ["auto", ...LANG_CODES] as [string, ...string[]];

const authEmailField = (message: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message })
    .regex(EMAIL_RE, { message });

export const otpRequestSchema = z.object({
  email: authEmailField("INVALID_EMAIL"),
  turnstileToken: z
    .string()
    .max(2048, { message: "TURNSTILE_INVALID" })
    .nullish(),
  appCheckToken: z.string().max(2048, { message: "INVALID_BODY" }).nullish(),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const loginSchema = z.object({
  email: authEmailField("Please enter a valid email address."),
});
export const otpSchema = z.object({
  token: z.string().length(6, "Please enter the 6-digit code."),
});

export type LoginForm = Pick<OtpRequest, "email">;
export type OtpForm = z.infer<typeof otpSchema>;

export const translateRequestSchema = z.object({
  text: z.string().max(10_000),
  targetLang: z.enum(LANG_CODES),
  sourceLang: z.enum(SOURCE_LANG_CODES).optional(),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

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

export const translateResponseSchema = z.object({
  translation: z.string(),
  transliteration: z.string().optional(),
  language: z.string().optional(),
  provider: z.string(),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;

export const transcribeResponseSchema = z.object({
  text: z.string(),

  duration: z.number().optional(),
  language: z.string().optional(),
  provider: z.string(),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

export const storePricingResponseSchema = z.object({
  currency: z.string(),

  price: z.number(),
  usd: z.number(),
  originalPriceUsd: z.number(),

  discountPercent: z.number(),

  annualPrice: z.number(),
  annualUsd: z.number(),

  originalAnnualUsd: z.number(),

  annualDiscountPercent: z.number(),
});
export type StorePricingResponse = z.infer<typeof storePricingResponseSchema>;

export const usageMeterSchema = z.object({
  id: z.enum(USAGE_METER_IDS),
  label: z.string(),
  unit: z.string(),
  used: z.number(),
  total: z.number(),
  remaining: z.number(),
});
export type UsageMeter = z.infer<typeof usageMeterSchema>;

export const usageSnapshotSchema = z.object({
  day: z.string(),
  resetsAt: z.number(),
  meters: z.array(usageMeterSchema),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

export const synthesizeRequestSchema = z.object({
  text: z.string().min(1).max(2_400).optional(),

  sourceLang: z.enum(SOURCE_LANG_CODES).optional(),
  targetLang: z.enum(LANG_CODES),
  gender: z.enum(["male", "female"]).optional(),
  voiceId: z.enum(VOICE_SLOT_IDS).optional(),
  reroll: z.number().int().min(0).max(1_000).optional(),
  /**
   * A voice-picker audition, not a real synthesis. Keys the shared speech cache
   * so the provider cost is one-off, and exempts it from the caller's quota.
   */
  isPreview: z.literal(true).optional(),
});
export type SynthesizeRequest = z.infer<typeof synthesizeRequestSchema>;

export const synthesizeResponseSchema = z.object({
  /**
   * Where the audio lives. The worker writes it to the speech cache and hands
   * back a URL, so the response stays a few hundred bytes no matter how long
   * the clip is. Serving it is a separate, cacheable GET.
   */
  audioUrl: z.string(),
  mime: z.string(),
  sourceLang: z.string(),
  targetLang: z.string(),
  translated: z.boolean(),
  voiceId: z.string(),
  durationMs: z.number().optional(),
  /**
   * The text that was spoken, and its translation when one was produced. The
   * worker always computed both — they are what it synthesised from — but used
   * to discard them, which meant the client could never archive what it had
   * just paid to understand. Returning them costs no extra inference.
   *
   * Optional so an older worker paired with a newer client still validates.
   */
  transcript: z.string().optional(),
  translation: z.string().nullable().optional(),
  /**
   * Set when the source text was longer than the translate budget allows, so the
   * worker translated only its opening span. `transcript` then describes that
   * same span rather than everything the user said, and this flag lets the
   * client say so instead of silently showing a partial translation.
   *
   * Optional so an older worker paired with a newer client still validates.
   */
  translationTruncated: z.boolean().optional(),
});
export type SynthesizeResponse = z.infer<typeof synthesizeResponseSchema>;

export const checkoutRequestSchema = z.object({
  plan: z.enum([PRO_PRODUCT_IDS.monthly, PRO_PRODUCT_IDS.annual]),

  currency: z
    .string()
    .min(3)
    .max(3)
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const checkoutResponseSchema = z.object({
  tx_ref: z.string(),
  amount: z.number(),
  currency: z.enum(FLUTTERWAVE_CURRENCIES),
  public_key: z.string(),
  link: z.string().optional(),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

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

export const billingFlagsResponseSchema = z.object({
  flutterwave_enabled: z.boolean(),
  default_provider: z.string(),
});
export type BillingFlagsResponse = z.infer<typeof billingFlagsResponseSchema>;

export const registerPushTokenRequestSchema = z.object({
  push_token: z
    .string()
    // Expo tokens are `ExponentPushToken[...]`. The bracket body is what makes
    // the broadcast list trustworthy: every active row is sent an update
    // notification, and registration is reachable without an account, so a
    // permissive pattern would let junk rows accumulate into that audience.
    .regex(
      /^ExponentPushToken\[[A-Za-z0-9_-]{20,120}\]$/,
      "push_token is not a valid Expo push token",
    )
    .max(256, "push_token is too long"),
  platform: z.enum(["ios", "android"]),
  app_version: z.string().max(32, "app_version is too long").optional(),
});
export type RegisterPushTokenRequest = z.infer<
  typeof registerPushTokenRequestSchema
>;

export const sharedHistoryRecordSchema = z.object({
  sessionKey: z.string().min(1),
  sourceLang: z.string().min(1),
  targetLang: z.string().min(1),
  transcript: z.string(),
  translation: z.string().nullish(),
  transliteration: z.string().nullish(),
  duration: z.number().optional(),
  sourceApp: z.string().optional(),
  provider: z.string().optional(),
  createdAt: z.string().optional(),
  /**
   * Written by newer share extensions. The share sheet only ever produces
   * `echo` captures, so a record that omits these is resolved by the reader
   * rather than rejected.
   */
  captureId: z.string().optional(),
  origin: z.string().optional(),
  input: z.string().optional(),
  voiceId: z.string().nullish(),
  mtProvider: z.string().nullish(),
});
export type SharedHistoryRecord = z.infer<typeof sharedHistoryRecordSchema>;

/** The wire contract for live dictation, in both directions. */

export const STREAM_AUDIO_FORMAT = "pcm_s16le" as const;
export const STREAM_SAMPLE_RATE = 16_000 as const;
export const STREAM_CHANNELS = 1 as const;
/** 20 ms device frames coalesced to 80 ms, inside every route's window. */
export const STREAM_FRAME_MS = 20 as const;
export const STREAM_CHUNK_MS = 80 as const;

export const streamTranscriptEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interim"),
    text: z.string(),
    provider: z.string(),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("final"),
    text: z.string(),
    provider: z.string(),
    /** Carried on the final so the language arrives with its text. */
    language: z.string().optional(),
  }),
]);
export type StreamTranscriptEvent = z.infer<typeof streamTranscriptEventSchema>;

export const streamControlMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("config_ack"), status: z.string() }),
  z.object({ type: z.literal("stop") }),
  z.object({
    type: z.literal("config_request"),
    format: z.string(),
    sampleRate: z.number(),
    channels: z.number(),
    frameSizeMs: z.number(),
  }),
  /** The provider socket is open. `config_ack` only means it was understood. */
  z.object({
    type: z.literal("ready"),
    route: z.string(),
    provider: z.string(),
    format: z.string(),
    sampleRate: z.number(),
    channels: z.number(),
  }),
  z.object({
    type: z.literal("language_detected"),
    language: z.string(),
    provider: z.string(),
  }),
  /** `languageReset`: failover dropped the pin, so detection starts afresh. */
  z.object({
    type: z.literal("provider_switch"),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
    languageReset: z.boolean().optional(),
  }),
]);
export type StreamControlMessage = z.infer<typeof streamControlMessageSchema>;

/** What the client may send the worker, in a shape the worker parses. */
export const streamClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("config"),
    lang: z.string(),
    format: z.string(),
    sampleRate: z.number(),
    channels: z.number(),
    frameSizeMs: z.number(),
  }),
  /** The device's voice-activity gate; a failover waits for the next false. */
  z.object({ type: z.literal("vad"), active: z.boolean() }),
  /** The user released the button, or a native silence timer fired. */
  z.object({ type: z.literal("force_endpoint") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("pong") }),
]);
export type StreamClientMessage = z.infer<typeof streamClientMessageSchema>;

export const streamErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type StreamError = z.infer<typeof streamErrorSchema>;

export const streamServerMessageSchema = z.union([
  streamTranscriptEventSchema,
  streamControlMessageSchema,
  streamErrorSchema,
]);
export type StreamServerMessage = z.infer<typeof streamServerMessageSchema>;

export const historyOutboxUpsertPayloadSchema = z.object({
  action: z.literal("upsert"),
  /**
   * Retained as a stored column, but no longer a user-facing concept: one row
   * now exists per capture, so whether it carries a translation is derivable
   * from `translation_text` being non-null.
   */
  type: z.enum(["transcription", "translation"]),
  /**
   * The `capture_id` / `origin` / `input` / `voice_id` / `mt_provider` fields
   * are optional because the outbox is a durable queue: a payload enqueued by
   * an older app version is still sitting in the table and must keep
   * validating, or it would be retried to death on every drain. The drain site
   * substitutes defaults for anything absent.
   */
  capture_id: z.string().nullish(),
  origin: z.string().optional(),
  input: z.string().optional(),
  source_lang: z.string(),
  target_lang: z.string(),
  transcript: z.string(),
  translation_text: z.string().nullable(),
  transliteration_text: z.string().nullable(),
  duration: z.number(),
  source_app: z.string().nullable().optional(),
  voice_id: z.string().nullish(),
  stt_provider: z.string().optional(),
  mt_provider: z.string().nullish(),
  created_at: z.string(),
  /**
   * The server revision this edit was based on, which is what lets the server
   * refuse a write that has been overtaken. Optional because the outbox is a
   * durable queue: a payload enqueued by an older app version has none and must
   * keep validating, or it would be retried to death on every drain. A payload
   * without one is applied last-write-wins.
   */
  base_revision: z.number().int().nonnegative().nullish(),
  /**
   * Undo of a delete. The server keeps a deleted row as a tombstone and refuses
   * an ordinary write over it, so this is the only way a row the user
   * deliberately deleted comes back. Absent on an ordinary write.
   */
  restore: z.boolean().optional(),
});
export const historyOutboxDeletePayloadSchema = z.object({
  action: z.literal("delete"),
  id: z.string(),
  /**
   * The revision this delete was based on. The server refuses a delete whose
   * base_revision has been overtaken, so a device removing a row it has not
   * caught up with cannot delete a newer edit. Null on a payload from an older
   * build, which is applied unconditionally rather than refused.
   */
  base_revision: z.number().int().nonnegative().nullish(),
});
export const historyOutboxDeleteAllPayloadSchema = z.object({
  action: z.literal("delete_all"),
});
export const historyOutboxPayloadSchema = z.discriminatedUnion("action", [
  historyOutboxUpsertPayloadSchema,
  historyOutboxDeletePayloadSchema,
  historyOutboxDeleteAllPayloadSchema,
]);
export type HistoryOutboxPayload = z.infer<typeof historyOutboxPayloadSchema>;

export const syncCursorSchema = z.object({
  created_at: z.string(),
  id: z.string(),
});
export type SyncCursor = z.infer<typeof syncCursorSchema>;

export const pushNotifyRequestSchema = z.object({
  version: z.string().trim().min(1),
  downloadUrl: z
    .url()
    .refine((u) => u.startsWith("https://"), "Must be an https:// URL"),
  versionCode: z.number().int().positive().optional(),
  checksumSha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
});
export type PushNotifyRequest = z.infer<typeof pushNotifyRequestSchema>;

export const updateManifestSchema = z
  .object({
    latest_version: z.string().trim().min(1),
    latest_version_code: z.number().int(),
    min_supported_version_code: z.number().int(),
    download_url: z
      .url()
      .refine((u) => u.startsWith("https://"), "Must be an https:// URL"),
    checksum_sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
    file_size: z.number().int().positive().optional(),
    release_notes: z.string().optional(),
  })
  .passthrough();
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export const webhookEventSchema = z
  .object({
    event: z.string().min(1).optional(),
    id: z.number().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
