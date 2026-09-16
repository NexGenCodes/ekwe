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

/**
 * Tracks subscription status per user. Written by the Worker (service_role)
 * via set_pro_status RPC when RevenueCat or Flutterwave confirms a payment.
 * Read by the custom_access_token_hook to inject `is_pro` into JWTs and by
 * check_preflight to derive the authoritative tier.
 */
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
    // Added by 20260818000000_dual_provider_billing
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
