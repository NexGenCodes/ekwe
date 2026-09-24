import {
  sqliteTable,
  text,
  real,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

export const history = sqliteTable(
  "history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    transcript: text("transcript").notNull(),
    translationText: text("translation_text"),
    transliterationText: text("transliteration_text"),
    duration: real("duration").notNull().default(0),
    sourceApp: text("source_app").notNull().default(""),
    provider: text("provider").notNull().default(""),
    createdAt: text("created_at").notNull(),
    entryType: text("entry_type").notNull().default("transcription"),
  },
  (table) => ({
    createdIdx: index("idx_history_created").on(table.createdAt),

    userIdx: index("idx_history_user").on(table.userId),

    userCreatedIdx: index("idx_history_user_created").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    dedupIdx: index("idx_history_dedup").on(
      table.userId,
      table.entryType,
      table.sourceLang,
      table.targetLang,
      table.transcript,
    ),
  }),
);

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    payload: text("payload").notNull(),
    userId: text("user_id").notNull(),
    retries: integer("retries").notNull().default(0),
    lastAttempt: integer("last_attempt"),
    createdAt: text("created_at").notNull(),
    status: text("status", { enum: ["pending", "in_flight", "dead"] })
      .notNull()
      .default("pending"),
  },
  (table) => ({
    statusIdx: index("idx_outbox_status").on(table.status),
    pendingOutboxIdx: index("idx_outbox_pending").on(
      table.userId,
      table.status,
      table.retries,
    ),
  }),
);
