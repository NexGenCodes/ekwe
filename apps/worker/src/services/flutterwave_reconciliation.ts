import { Env } from "../core/types";
import { logger } from "../core/logger";
import { supabasePost } from "./supabase";
import { processMissingTransaction } from "../routes/flutterwave";

/**
 * Type for Flutterwave /v3/transactions response
 */
export interface FlwTransactionsResponse {
  status: string;
  message: string;
  meta: {
    page_info: {
      total: number;
      current_page: number;
      total_pages: number;
    };
  };
  data: Array<{
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
    customer: {
      id: number;
      name: string;
      email: string;
      phone_number: string | null;
    };
    meta?: {
      user_id?: string;
      plan?: string;
    };
  }>;
}

/**
 * Fetch successful transactions from Flutterwave API for the last N days
 */
export async function fetchRecentSuccessfulTransactions(
  env: Env,
  daysAgo: number = 2,
): Promise<FlwTransactionsResponse["data"]> {
  if (!env.FLUTTERWAVE_SECRET) {
    throw new Error("FLUTTERWAVE_SECRET not configured");
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysAgo);
  const fromIso = fromDate.toISOString().split("T")[0]; // YYYY-MM-DD

  let allTransactions: FlwTransactionsResponse["data"] = [];
  let currentPage = 1;
  let totalPages: number;

  do {
    const url = `https://api.flutterwave.com/v3/transactions?status=successful&from=${fromIso}&page=${currentPage}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Flutterwave API error: ${res.status}`);
    }

    const payload: FlwTransactionsResponse = await res.json();
    if (payload.status === "success" && Array.isArray(payload.data)) {
      allTransactions = allTransactions.concat(payload.data);
      totalPages = payload.meta?.page_info?.total_pages ?? 1;
    } else {
      break;
    }
    currentPage++;
  } while (currentPage <= totalPages);

  return allTransactions;
}

/**
 * Calls the Supabase RPC to filter out transactions we already processed.
 */
export async function getMissingTransactions(
  env: Env,
  flwRefs: string[],
): Promise<string[]> {
  if (flwRefs.length === 0) return [];

  const res = await supabasePost(
    env,
    "/rest/v1/rpc/get_missing_flutterwave_transactions",
    { p_flw_refs: flwRefs },
  );

  if (!res || !res.ok) {
    throw new Error(
      `[reconciliation] Failed to fetch missing transactions (status: ${res?.status ?? "no response"})`,
    );
  }

  // Supabase RPC returns array of { missing_ref: string }
  const data: Array<{ missing_ref: string }> = await res.json();
  return data.map((d) => d.missing_ref);
}

/**
 * Main cron entrypoint. Fetches recent transactions, checks for missing ones,
 * and processes any that fell through the cracks.
 */
export async function reconcileFlutterwaveTransactions(
  env: Env,
): Promise<void> {
  try {
    logger.info(
      "[reconciliation] Starting Flutterwave billing reconciliation...",
    );
    const transactions = await fetchRecentSuccessfulTransactions(env, 2);
    if (transactions.length === 0) {
      logger.info("[reconciliation] No recent transactions found.");
      return;
    }

    const flwRefs = transactions.map((t) => t.flw_ref).filter(Boolean);
    const missingRefs = await getMissingTransactions(env, flwRefs);

    if (missingRefs.length === 0) {
      logger.info(
        "[reconciliation] All recent transactions are already in the ledger.",
      );
      return;
    }

    logger.info(
      `[reconciliation] Found ${missingRefs.length} missing transactions. Processing...`,
    );

    let successCount = 0;
    let terminalFailures = 0;
    let retryableFailures = 0;
    for (const missingRef of missingRefs) {
      const tx = transactions.find((t) => t.flw_ref === missingRef);
      if (!tx) continue;

      try {
        // processMissingTransaction handles amount validation, user lookup,
        // and ledger insertion. A `false` return is a permanent outcome
        // (unresolvable user, amount mismatch) and must not trigger retries.
        const processed = await processMissingTransaction(env, tx);
        if (processed) successCount++;
        else terminalFailures++;
      } catch (err) {
        // Transient failure (Flutterwave/Supabase). Log it and keep sweeping;
        // unreconciled refs stay "missing" and are retried by the next run.
        // If the batch made no progress AND something threw, propagate so the
        // queue consumer retries instead of silently swallowing the failure.
        retryableFailures++;
        logger.error(
          `[reconciliation] Failed to process missing ref ${missingRef}`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    if (successCount === 0 && retryableFailures > 0) {
      throw new Error(
        `[reconciliation] No transactions applied (${terminalFailures} terminal, ${retryableFailures} retryable). Triggering queue retry.`,
      );
    }
    if (retryableFailures > 0) {
      logger.warn(
        `[reconciliation] Reconciled ${successCount}/${missingRefs.length}; ` +
          `${retryableFailures} transient failure(s) left for the next sweep.`,
      );
    }

    logger.info(
      `[reconciliation] Completed processing. Successfully reconciled ${successCount}/${missingRefs.length} missing transactions.`,
    );
  } catch (err) {
    logger.error("[reconciliation] Flutterwave reconciliation job failed", {
      error: String(err),
    });
    throw err;
  }
}
