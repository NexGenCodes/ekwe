import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  primaryKey,
  foreignKey,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersInAuth } from "./history";

export const userDailyUsage = pgTable(
  "user_daily_usage",
  {
    userId: uuid("user_id").notNull(),
    day: text("day").notNull(),
    translateCount: integer("translate_count").notNull().default(0),
    transcribeCount: integer("transcribe_count").notNull().default(0),
    speechChars: integer("speech_chars").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersInAuth.id],
      name: "user_daily_usage_user_id_fkey",
    }).onDelete("cascade"),
    pgPolicy("Users can view their own daily usage", {
      as: "permissive",
      for: "select",
      to: ["public"],
      using: sql`(auth.uid() = user_id)`,
    }),
  ],
);
