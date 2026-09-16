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

/**
 * Stub for the Supabase-managed `auth.users` table so the history FK can be
 * declared. Never modified by Drizzle migrations; the auth schema is owned by
 * Supabase Auth.
 */
export const usersInAuth = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const history = pgTable(
  "history",
  {
    id: text("id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    transcript: text("transcript").notNull(),
    translationText: text("translation_text"),
    duration: real("duration").default(0).notNull(),
    sourceApp: text("source_app").default("Unknown App").notNull(),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    transliterationText: text("transliteration_text"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
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
