import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  foreignKey,
  unique,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersInAuth } from "./history";

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    status: text("status").notNull().default("inactive"),
    productId: text("product_id"),
    platform: text("platform"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),

    provider: text("provider").notNull().default("revenuecat"),
    paymentReference: text("payment_reference"),
    flutterwaveTxRef: text("flutterwave_tx_ref"),
  },
  (table) => [
    unique("user_subscriptions_user_id_key").on(table.userId),
    index("idx_user_subscriptions_user_id").on(table.userId),
    index("idx_user_subscriptions_status").on(table.status),
    index("idx_user_subscriptions_provider").on(table.provider),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersInAuth.id],
      name: "user_subscriptions_user_id_fkey",
    }).onDelete("cascade"),
    pgPolicy("Users can read own subscription", {
      as: "permissive",
      for: "select",
      to: ["public"],
      using: sql`(auth.uid() = user_id)`,
    }),
  ],
);
