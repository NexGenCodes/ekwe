import {
  pgTable,
  pgSchema,
  text,
  uuid,
  real,
  timestamp,
  index,
  foreignKey,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authSchema = pgSchema("auth");

export const usersInAuth = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const history = pgTable(
  "history",
  {
    id: text("id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    /**
     * Stable identifier for the capture session. One capture yields one row:
     * transcription writes it with a null translation, a later translation
     * updates it in place. Null on rows written before this column existed.
     */
    captureId: text("capture_id"),
    /** Which surface captured it: speech-studio | echo | orb. */
    origin: text("origin").default("echo").notNull(),
    /** What that surface consumed: audio | text. */
    input: text("input").default("audio").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    transcript: text("transcript").notNull(),
    translationText: text("translation_text"),
    duration: real("duration").default(0).notNull(),
    /**
     * The external app the audio came from. Empty for in-app captures, which
     * the client sends explicitly; the column default only covers rows that
     * somehow arrive without the field.
     */
    sourceApp: text("source_app").default("").notNull(),
    /** Voice slot used to render speech, for Studio entries. */
    voiceId: text("voice_id"),
    /**
     * Which speech-to-text provider heard it.
     *
     * The table's `provider` column is not mapped here, and is not going to be:
     * it stays in the database so pre-split app builds can still read and write
     * it. `stt_provider` and `mt_provider` are what this app uses. This schema
     * therefore matches the database except for that one unmapped column, and
     * is safe to push.
     */
    sttProvider: text("stt_provider").default("").notNull(),
    /** Which MT provider translated it. Null until translated. */
    mtProvider: text("mt_provider"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    transliterationText: text("transliteration_text"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    /**
     * Retained as a stored column only. One row now exists per capture, so
     * whether a translation exists is derivable from `translation_text`.
     */
    type: text("type").default("transcription").notNull(),
  },
  (table) => [
    index("idx_history_created_at").using(
      "btree",
      table.createdAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    index("idx_history_updated_at").using(
      "btree",
      table.updatedAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    index("idx_history_user_id").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_history_user_capture").using(
      "btree",
      table.userId.asc().op("uuid_ops"),
      table.captureId.asc().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersInAuth.id],
      name: "history_user_id_fkey",
    }).onDelete("cascade"),
    pgPolicy("Users can delete own history", {
      as: "permissive",
      for: "delete",
      to: ["public"],
      using: sql`(auth.uid() = user_id)`,
    }),
    pgPolicy("Users can insert own history", {
      as: "permissive",
      for: "insert",
      to: ["public"],
      withCheck: sql`(auth.uid() = user_id)`,
    }),
    pgPolicy("Users can read own history", {
      as: "permissive",
      for: "select",
      to: ["public"],
      using: sql`(auth.uid() = user_id)`,
    }),
    pgPolicy("Users can update own history", {
      as: "permissive",
      for: "update",
      to: ["public"],
      using: sql`(auth.uid() = user_id)`,
      withCheck: sql`(auth.uid() = user_id)`,
    }),
  ],
);
