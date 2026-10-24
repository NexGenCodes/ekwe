import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  emailNorm: text("email_norm").notNull().unique(),
  tier: text("tier", { enum: ["FREE", "PREMIUM"] })
    .notNull()
    .default("FREE"),
  proExpiresAt: integer("pro_expires_at"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  avatarIcon: text("avatar_icon"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const identities = sqliteTable(
  "identities",
  {
    provider: text("provider", {
      enum: ["email", "apple", "google"],
    }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    index("idx_identities_user").on(t.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgent: text("user_agent"),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const sessionRotations = sqliteTable(
  "session_rotations",
  {
    refreshHash: text("refresh_hash").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    issuedAt: integer("issued_at").notNull(),
    replacedBy: text("replaced_by"),
    usedAt: integer("used_at"),
  },
  (t) => [index("idx_session_rotations_session").on(t.sessionId)],
);

export const otpCodes = sqliteTable("otp_codes", {
  emailNorm: text("email_norm").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: integer("last_sent_at").notNull(),
});

export const history = sqliteTable(
  "history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull().default("transcription"),
    captureId: text("capture_id"),
    origin: text("origin").notNull().default("echo"),
    input: text("input").notNull().default("audio"),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    transcript: text("transcript").notNull().default(""),
    translationText: text("translation_text"),
    transliterationText: text("transliteration_text"),
    duration: real("duration").notNull().default(0),
    sourceApp: text("source_app").notNull().default(""),
    voiceId: text("voice_id"),
    sttProvider: text("stt_provider").notNull().default(""),
    mtProvider: text("mt_provider"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("idx_history_live_user")
      .on(t.userId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_history_user_capture").on(t.userId, t.captureId),
  ],
);

export const userSubscriptions = sqliteTable("user_subscriptions", {
  userId: text("user_id").primaryKey(),
  status: text("status", {
    enum: ["active", "inactive", "expired", "cancelled"],
  })
    .notNull()
    .default("inactive"),
  productId: text("product_id"),
  platform: text("platform", { enum: ["ios", "android", "web"] }),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userDailyUsage = sqliteTable(
  "user_daily_usage",
  {
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    translateCount: integer("translate_count").notNull().default(0),
    transcribeCount: integer("transcribe_count").notNull().default(0),
    speechChars: integer("speech_chars").notNull().default(0),
    streamCount: integer("stream_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const flutterwaveClaims = sqliteTable(
  "flutterwave_claims",
  {
    flwRef: text("flw_ref").primaryKey(),
    userId: text("user_id").notNull(),
    txRef: text("tx_ref").notNull(),
    amount: real("amount"),
    currency: text("currency"),
    expiresAt: integer("expires_at").notNull(),
    claimedAt: integer("claimed_at").notNull(),
  },
  (t) => [index("idx_flw_claims_user").on(t.userId, t.claimedAt)],
);

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey(),
  revenuecatEnabled: integer("revenuecat_enabled").notNull().default(1),
  flutterwaveEnabled: integer("flutterwave_enabled").notNull().default(0),
  defaultProvider: text("default_provider", {
    enum: ["revenuecat", "flutterwave"],
  })
    .notNull()
    .default("revenuecat"),
  basePriceUsd: real("base_price_usd").notNull().default(2),
  discountPercent: real("discount_percent").notNull().default(0),
  annualDiscountPercent: real("annual_discount_percent").notNull().default(20),
  localPrices: text("local_prices").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull(),
});

export const pushTokens = sqliteTable(
  "push_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    pushToken: text("push_token").notNull().unique(),
    platform: text("platform", { enum: ["android", "ios"] }).notNull(),
    appVersion: text("app_version"),
    isActive: integer("is_active").notNull().default(1),
    lastUsedAt: integer("last_used_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_push_tokens_user").on(t.userId)],
);
