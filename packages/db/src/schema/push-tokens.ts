import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  index,
  foreignKey,
  pgPolicy,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersInAuth } from "./history";

/**
 * Stores Expo push tokens per device so the Worker can send APK
 * update notifications when a new version is built.
 *
 * user_id is nullable: tokens are registered at app launch before sign-in.
 * Security: RLS enabled, service_role only via bypass.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    pushToken: text("push_token").notNull().unique(),
    platform: text("platform").notNull().default("android"),
    appVersion: text("app_version"),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "push_tokens_platform_check",
      sql`${table.platform} IN ('android', 'ios')`,
    ),
    index("idx_push_tokens_user_id")
      .on(table.userId)
      .where(sql`is_active = TRUE`),
    index("idx_push_tokens_token").on(table.pushToken),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersInAuth.id],
      name: "push_tokens_user_id_fkey",
    }).onDelete("cascade"),
    pgPolicy("Service role can manage push_tokens", {
      as: "permissive",
      for: "all",
      to: ["service_role"],
      using: sql`TRUE`,
      withCheck: sql`TRUE`,
    }),
  ],
);
