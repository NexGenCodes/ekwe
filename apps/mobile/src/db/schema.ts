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
    /**
     * Stable identifier for the capture session that produced this row. One
     * capture yields exactly one row: transcribing writes it with a null
     * translation, and a later translation updates the same row in place.
     * This replaces a dedup key built from the entry's text, which could not
     * match across the transcription/translation pair and so left an orphan
     * row behind every time a note was translated.
     */
    captureId: text("capture_id"),
    /** Which surface captured it: speech-studio | echo | orb. */
    origin: text("origin").notNull().default("echo"),
    /** What that surface consumed: audio | text. */
    input: text("input").notNull().default("audio"),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    transcript: text("transcript").notNull(),
    translationText: text("translation_text"),
    transliterationText: text("transliteration_text"),
    /** Seconds of *source* audio. 0 when nothing was recorded. */
    duration: real("duration").notNull().default(0),
    /** The external app the audio came from. Null for in-app captures. */
    sourceApp: text("source_app").notNull().default(""),
    /** Voice slot used to render speech, for Studio entries. */
    voiceId: text("voice_id"),
    /** Which speech-to-text provider heard it. */
    sttProvider: text("stt_provider").notNull().default(""),
    /** Which machine-translation provider translated it. Null until translated. */
    mtProvider: text("mt_provider"),
    createdAt: text("created_at").notNull(),
    /**
     * Server-assigned version of this row, mirrored from the cloud.
     *
     * A local edit does not change it: it records what the server last
     * confirmed. The next push sends it as `base_revision`, so the server can
     * tell whether this device's edit was based on current data. Zero means the
     * row has never been pushed (or was written by an older app version), and
     * the server falls back to insert or last-write-wins for it.
     */
    revision: integer("revision").notNull().default(0),
    /**
     * Retained only as a stored column. It is no longer a user-facing concept:
     * one row exists per capture, so whether a translation exists is derivable
     * from `translation_text` being non-null.
     */
    entryType: text("entry_type").notNull().default("transcription"),
    /**
     * Mirrors the server's tombstone. A deleted row stays in the table (with
     * this set) so the revision the server assigned to the tombstone survives;
     * an Undo needs that revision to restore the row through the
     * revision-guarded upsert. Every read filters `deleted_at IS NULL`.
     */
    deletedAt: integer("deleted_at"),
  },
  (table) => ({
    createdIdx: index("idx_history_created").on(table.createdAt),

    userIdx: index("idx_history_user").on(table.userId),

    userCreatedIdx: index("idx_history_user_created").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    /** Serves the per-user lookup by capture id during sync. */
    userCaptureIdx: index("idx_history_user_capture").on(
      table.userId,
      table.captureId,
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
