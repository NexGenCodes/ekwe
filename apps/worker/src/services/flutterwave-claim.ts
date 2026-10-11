import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { sql } from "drizzle-orm";
import type { BillingPlanPeriod } from "@/services/flutterwave";

export interface FlutterwaveClaim {
  expiresAt: string;
  shouldActivate: boolean;
}

interface ClaimRpcResponse {
  expires_at: string | null;
  should_activate: boolean | null;
}

export async function claimFlutterwaveTransaction(
  env: Env,
  input: {
    flwRef: string;
    userId: string;
    txRef: string;
    amount: number;
    currency: string;
    period: BillingPlanPeriod;
  },
): Promise<FlutterwaveClaim | null> {
  try {
    // Keyed on flw_ref with ON CONFLICT DO NOTHING, so a retry returns the
    // same claim instead of granting twice.
    const result = await retryOnConnectionLoss(
      (client) =>
        client.execute(sql`SELECT * FROM claim_flutterwave_transaction(
      ${input.flwRef},
      ${input.userId},
      ${input.txRef},
      ${input.amount},
      ${input.currency},
      ${input.period}
    )`),
      env,
    );

    const row = result[0] as unknown as ClaimRpcResponse | undefined;

    if (!row || typeof row.expires_at !== "string") {
      logger.error("[billing/claim] Claim RPC returned no expiry", {
        flw_ref: input.flwRef,
      });
      return null;
    }

    return {
      expiresAt: row.expires_at,
      shouldActivate: row.should_activate === true,
    };
  } catch (err) {
    logger.error("[billing/claim] Claim RPC failed", {
      error: describeError(err),
    });
    return null;
  }
}
