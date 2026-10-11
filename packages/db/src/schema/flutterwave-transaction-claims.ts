import {
  pgTable,
  text,
  uuid,
  numeric,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { usersInAuth } from "./history";

/**
 * One row per redeemed Flutterwave transaction. The primary key on flw_ref is
 * the replay guard: a transaction extends a subscription at most once. Written
 * only through claim_flutterwave_transaction, so no client-facing policy is
 * declared here — access is granted at the GRANT layer, not to anon/authenticated.
 */
export const flutterwaveTransactionClaims = pgTable(
  "flutterwave_transaction_claims",
  {
    flwRef: text("flw_ref").primaryKey(),
    userId: uuid("user_id").notNull(),
    txRef: text("tx_ref").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_fw_claims_user").on(table.userId, table.claimedAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersInAuth.id],
      name: "flutterwave_transaction_claims_user_id_fkey",
    }).onDelete("cascade"),
  ],
);
