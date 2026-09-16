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
    /** Descending time index for ORDER BY created_at DESC queries. */
    createdIdx: index("idx_history_created").on(table.createdAt),
    /** User filter index. */
    userIdx: index("idx_history_user").on(table.userId),
    /** Composite covering index for the main query: WHERE user_id = ? ORDER BY created_at DESC. */
    userCreatedIdx: index("idx_history_user_created").on(
      table.userId,
      table.createdAt,
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
    /** Status filter index for getPendingOutbox queries. */
    statusIdx: index("idx_outbox_status").on(table.status),
  }),
);
