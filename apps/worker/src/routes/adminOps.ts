import type { Context } from "hono";
import type { AppEnv } from "@/app";
import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { isProviderDegraded } from "@/services/health";
import { PROVIDER_MODULES } from "@/providers";
import { error } from "@/core/http";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { syncFlutterwaveBillingData } from "@/services/flutterwave";

async function audit(
  env: Env,
  adminEmail: string,
  action: string,
  detail: string | null,
) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit_log (admin_email, action, target_user_id, detail, created_at) VALUES (?, ?, NULL, ?, ?)",
    )
      .bind(adminEmail, action, detail, Date.now())
      .run();
  } catch (e) {
    logger.warn("[admin-ops] audit failed", { error: String(e) });
  }
}

type BillingSection =
  | "all"
  | "summary"
  | "subscriptions"
  | "claims"
  | "entitlements"
  | "events"
  | "attempts"
  | "refunds"
  | "disputes"
  | "records";

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function likeParam(q: string): string {
  return `%${q.toLowerCase()}%`;
}

export async function handleBilling(c: Context<AppEnv>) {
  const env = c.env;
  const now = Date.now();
  const section = (c.req.query("section")?.trim().toLowerCase() ||
    "all") as BillingSection;
  const userId = c.req.query("userId")?.trim() ?? "";
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const status = c.req.query("status")?.trim().toLowerCase() ?? "";
  const source = c.req.query("source")?.trim().toLowerCase() ?? "";
  const platform = c.req.query("platform")?.trim().toLowerCase() ?? "";
  const coverage = c.req.query("coverage")?.trim().toLowerCase() ?? "";
  const eventType = c.req.query("eventType")?.trim().toLowerCase() ?? "";
  const limit = Math.min(
    Math.max(parsePositiveInt(c.req.query("limit"), 25, 100), 1),
    100,
  );
  const offset = Math.max(
    parsePositiveInt(c.req.query("offset"), 0, 100000),
    0,
  );

  try {
    const summary = await (async () => {
      const [
        subsActive,
        subsTotal,
        entActive,
        entTotal,
        claimsTotal,
        claimsActive,
        amounts,
        eventsTotal,
        eventsSucceeded,
        eventsFailed,
        eventsPending,
        eventsRefunded,
      ] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM user_subscriptions
              WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)`,
        )
          .bind(now)
          .first<{ n: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM user_subscriptions`).first<{
          n: number;
        }>(),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM user_entitlements
              WHERE plan = 'premium' AND status = 'active'
                AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?)`,
        )
          .bind(now, now)
          .first<{ n: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM user_entitlements`).first<{
          n: number;
        }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM flutterwave_claims`).first<{
          n: number;
        }>(),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM flutterwave_claims WHERE expires_at > ?`,
        )
          .bind(now)
          .first<{ n: number }>(),
        env.DB.prepare(
          `SELECT COALESCE(currency, 'UNKNOWN') AS currency,
                    ROUND(SUM(COALESCE(amount, 0)), 2) AS total,
                    COUNT(*) AS count
               FROM flutterwave_claims
              GROUP BY COALESCE(currency, 'UNKNOWN')
              ORDER BY total DESC`,
        ).all<{ currency: string; total: number; count: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM billing_events`)
          .first<{ n: number }>()
          .catch(() => ({ n: 0 })),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM billing_events WHERE status = 'succeeded'`,
        )
          .first<{ n: number }>()
          .catch(() => ({ n: 0 })),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM billing_events WHERE status = 'failed'`,
        )
          .first<{ n: number }>()
          .catch(() => ({ n: 0 })),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM billing_events WHERE status = 'pending'`,
        )
          .first<{ n: number }>()
          .catch(() => ({ n: 0 })),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM billing_events WHERE status = 'refunded'`,
        )
          .first<{ n: number }>()
          .catch(() => ({ n: 0 })),
      ]);
      return {
        activeSubscriptions: subsActive?.n ?? 0,
        subscriptionsTotal: subsTotal?.n ?? 0,
        activePremiumEntitlements: entActive?.n ?? 0,
        entitlementsTotal: entTotal?.n ?? 0,
        claimsTotal: claimsTotal?.n ?? 0,
        claimsWithActiveCoverage: claimsActive?.n ?? 0,
        claimAmountsByCurrency: (amounts.results ?? []).map((r) => ({
          currency: r.currency || "UNKNOWN",
          total: Number(r.total ?? 0),
          count: Number(r.count ?? 0),
        })),
        eventsTotal: eventsTotal?.n ?? 0,
        eventsSucceeded: eventsSucceeded?.n ?? 0,
        eventsFailed: eventsFailed?.n ?? 0,
        eventsPending: eventsPending?.n ?? 0,
        eventsRefunded: eventsRefunded?.n ?? 0,
      };
    })();

    const loadSubscriptions = async () => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (userId) {
        where.push("s.user_id = ?");
        binds.push(userId);
      }
      if (status) {
        where.push("lower(s.status) = ?");
        binds.push(status);
      }
      if (platform) {
        where.push("lower(COALESCE(s.platform, '')) = ?");
        binds.push(platform);
      }
      if (q) {
        where.push(
          "(lower(s.user_id) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ? OR lower(COALESCE(s.product_id,'')) LIKE ?)",
        );
        const p = likeParam(q);
        binds.push(p, p, p, p);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const base = `FROM user_subscriptions s LEFT JOIN users u ON u.id = s.user_id ${whereSql}`;
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
        .bind(...binds)
        .first<{ n: number }>();
      const rows = await env.DB.prepare(
        `SELECT s.user_id, s.status, s.product_id, s.platform, s.expires_at, s.created_at, s.updated_at,
                u.email AS user_email, u.display_name AS user_display_name,
                COALESCE(u.role, 'user') AS user_role, u.tier AS user_tier
           ${base}
          ORDER BY s.updated_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all<Record<string, unknown>>();
      return {
        items: rows.results ?? [],
        total: countRow?.n ?? 0,
        limit,
        offset,
      };
    };

    const loadClaims = async () => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (userId) {
        where.push("c.user_id = ?");
        binds.push(userId);
      }
      if (coverage === "active") {
        where.push("c.expires_at > ?");
        binds.push(now);
      } else if (coverage === "expired") {
        where.push("c.expires_at <= ?");
        binds.push(now);
      }
      if (q) {
        where.push(
          "(lower(c.user_id) LIKE ? OR lower(c.flw_ref) LIKE ? OR lower(c.tx_ref) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ?)",
        );
        const p = likeParam(q);
        binds.push(p, p, p, p, p);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const base = `FROM flutterwave_claims c LEFT JOIN users u ON u.id = c.user_id ${whereSql}`;
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
        .bind(...binds)
        .first<{ n: number }>();
      const rows = await env.DB.prepare(
        `SELECT c.flw_ref, c.user_id, c.tx_ref, c.amount, c.currency, c.expires_at, c.claimed_at,
                u.email AS user_email, u.display_name AS user_display_name,
                COALESCE(u.role, 'user') AS user_role
           ${base}
          ORDER BY c.claimed_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all<Record<string, unknown>>();
      return {
        items: rows.results ?? [],
        total: countRow?.n ?? 0,
        limit,
        offset,
      };
    };

    const loadEntitlements = async () => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (userId) {
        where.push("e.user_id = ?");
        binds.push(userId);
      }
      if (source) {
        where.push("lower(e.source) = ?");
        binds.push(source);
      }
      if (status) {
        where.push("lower(e.status) = ?");
        binds.push(status);
      }
      if (q) {
        where.push(
          "(lower(e.user_id) LIKE ? OR lower(COALESCE(e.granted_by,'')) LIKE ? OR lower(COALESCE(e.reason,'')) LIKE ? OR lower(COALESCE(e.external_ref,'')) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ?)",
        );
        const p = likeParam(q);
        binds.push(p, p, p, p, p, p);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const base = `FROM user_entitlements e LEFT JOIN users u ON u.id = e.user_id ${whereSql}`;
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
        .bind(...binds)
        .first<{ n: number }>();
      const rows = await env.DB.prepare(
        `SELECT e.id, e.user_id, e.plan, e.source, e.status, e.starts_at, e.expires_at,
                e.granted_by, e.reason, e.external_ref, e.created_at, e.updated_at,
                u.email AS user_email, u.display_name AS user_display_name,
                COALESCE(u.role, 'user') AS user_role
           ${base}
          ORDER BY e.updated_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all<Record<string, unknown>>();
      return {
        items: rows.results ?? [],
        total: countRow?.n ?? 0,
        limit,
        offset,
      };
    };

    const loadEvents = async () => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (userId) {
        where.push("ev.user_id = ?");
        binds.push(userId);
      }
      if (status) {
        where.push("lower(ev.status) = ?");
        binds.push(status);
      }
      if (eventType) {
        where.push("lower(ev.event_type) = ?");
        binds.push(eventType);
      }
      if (q) {
        where.push(
          "(lower(COALESCE(ev.user_id,'')) LIKE ? OR lower(COALESCE(ev.tx_ref,'')) LIKE ? OR lower(COALESCE(ev.flw_ref,'')) LIKE ? OR lower(COALESCE(ev.external_id,'')) LIKE ? OR lower(COALESCE(ev.event_type,'')) LIKE ? OR lower(COALESCE(ev.message,'')) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ?)",
        );
        const p = likeParam(q);
        binds.push(p, p, p, p, p, p, p, p);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const base = `FROM billing_events ev LEFT JOIN users u ON u.id = ev.user_id ${whereSql}`;
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
        .bind(...binds)
        .first<{ n: number }>()
        .catch(() => ({ n: 0 }));
      const rows = await env.DB.prepare(
        `SELECT ev.id, ev.provider, ev.event_key, ev.event_type, ev.status, ev.user_id,
                ev.tx_ref, ev.flw_ref, ev.external_id, ev.amount, ev.currency, ev.plan,
                ev.platform, ev.message, ev.detail, ev.occurred_at, ev.created_at,
                u.email AS user_email, u.display_name AS user_display_name,
                COALESCE(u.role, 'user') AS user_role
           ${base}
          ORDER BY COALESCE(ev.occurred_at, ev.created_at) DESC, ev.created_at DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all<Record<string, unknown>>()
        .catch(() => ({ results: [] as Record<string, unknown>[] }));
      return {
        items: rows.results ?? [],
        total: countRow?.n ?? 0,
        limit,
        offset,
      };
    };

    const loadSimpleLedger = async (
      table: string,
      alias: string,
      extraCols = "",
    ) => {
      const where: string[] = ["1=1"];
      const binds: unknown[] = [];
      if (userId) {
        where.push(`${alias}.user_id = ?`);
        binds.push(userId);
      }
      if (status) {
        where.push(`lower(${alias}.status) = ?`);
        binds.push(status);
      }
      if (q) {
        where.push(
          `(lower(COALESCE(${alias}.user_id,'')) LIKE ? OR lower(COALESCE(${alias}.tx_ref,'')) LIKE ? OR lower(COALESCE(${alias}.flw_ref,'')) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ?)`,
        );
        const p = likeParam(q);
        binds.push(p, p, p, p);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;
      const base = `FROM ${table} ${alias} LEFT JOIN users u ON u.id = ${alias}.user_id ${whereSql}`;
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
        .bind(...binds)
        .first<{ n: number }>()
        .catch(() => ({ n: 0 }));
      const rows = await env.DB.prepare(
        `SELECT ${alias}.*${extraCols}, u.email AS user_email, u.display_name AS user_display_name, COALESCE(u.role,'user') AS user_role ${base} ORDER BY ${alias}.updated_at DESC LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all<Record<string, unknown>>()
        .catch(() => ({ results: [] as Record<string, unknown>[] }));
      return {
        items: rows.results ?? [],
        total: countRow?.n ?? 0,
        limit,
        offset,
      };
    };

    const wantAll = section === "all";
    const [
      subscriptions,
      claims,
      entitlements,
      events,
      attempts,
      refunds,
      disputes,
    ] = await Promise.all([
      wantAll || section === "subscriptions" || userId
        ? loadSubscriptions()
        : Promise.resolve(null),
      wantAll || section === "claims" || userId
        ? loadClaims()
        : Promise.resolve(null),
      wantAll || section === "entitlements" || userId
        ? loadEntitlements()
        : Promise.resolve(null),
      wantAll || section === "events" || userId
        ? loadEvents()
        : Promise.resolve(null),
      wantAll || section === "attempts" || userId
        ? loadSimpleLedger("billing_payment_attempts", "a")
        : Promise.resolve(null),
      wantAll || section === "refunds" || userId
        ? loadSimpleLedger("billing_refunds", "r")
        : Promise.resolve(null),
      wantAll || section === "disputes" || userId
        ? loadSimpleLedger("billing_disputes", "d")
        : Promise.resolve(null),
    ]);

    if (section === "summary") return c.json({ summary });

    const response: Record<string, unknown> = { summary };
    if (subscriptions) response.subscriptions = subscriptions;
    if (claims) response.claims = claims;
    if (entitlements) response.entitlements = entitlements;
    if (events) response.events = events;
    if (attempts) response.attempts = attempts;
    if (refunds) response.refunds = refunds;
    if (disputes) response.disputes = disputes;
    return c.json(response);
  } catch (e) {
    logger.error("[admin-ops] billing query failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return error(
      WORKER_ERROR_CODES.SERVER_ERROR,
      500,
      "Failed to load billing data.",
    );
  }
}

export async function handleUsage(c: Context<AppEnv>) {
  const env = c.env;
  const userId = c.req.query("userId")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const where = userId ? "WHERE user_id = ?" : "";
  const binds = userId ? [userId] : [];

  const [daily, monthly, dailyCount, monthlyCount, dailyAgg, monthlyAgg] =
    await Promise.all([
      env.DB.prepare(
        `SELECT user_id, day, translate_count, transcribe_count, transcribe_ms, speech_chars, stream_count, stream_ms, ai_credits
         FROM user_daily_usage ${where} ORDER BY day DESC, user_id ASC LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT user_id, month, translate_count, transcribe_count, transcribe_ms, speech_chars, stream_count, stream_ms, ai_credits
         FROM user_monthly_usage ${where} ORDER BY month DESC, user_id ASC LIMIT ? OFFSET ?`,
      )
        .bind(...binds, limit, offset)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM user_daily_usage ${where}`)
        .bind(...binds)
        .first<{ n: number }>()
        .catch(() => ({ n: 0 })),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM user_monthly_usage ${where}`)
        .bind(...binds)
        .first<{ n: number }>()
        .catch(() => ({ n: 0 })),
      env.DB.prepare(
        `SELECT COALESCE(SUM(translate_count),0) AS translate_count,
              COALESCE(SUM(transcribe_count),0) AS transcribe_count,
              COALESCE(SUM(speech_chars),0) AS speech_chars,
              COALESCE(SUM(stream_count),0) AS stream_count,
              COALESCE(SUM(ai_credits),0) AS ai_credits
         FROM user_daily_usage ${where}`,
      )
        .bind(...binds)
        .first<Record<string, number>>()
        .catch(() => null),
      env.DB.prepare(
        `SELECT COALESCE(SUM(translate_count),0) AS translate_count,
              COALESCE(SUM(transcribe_count),0) AS transcribe_count,
              COALESCE(SUM(speech_chars),0) AS speech_chars,
              COALESCE(SUM(stream_count),0) AS stream_count,
              COALESCE(SUM(ai_credits),0) AS ai_credits
         FROM user_monthly_usage ${where}`,
      )
        .bind(...binds)
        .first<Record<string, number>>()
        .catch(() => null),
    ]);

  return c.json({
    daily: daily.results ?? [],
    monthly: monthly.results ?? [],
    dailyTotal: dailyCount?.n ?? 0,
    monthlyTotal: monthlyCount?.n ?? 0,
    dailyAggregate: {
      translate_count: Number(dailyAgg?.translate_count ?? 0),
      transcribe_count: Number(dailyAgg?.transcribe_count ?? 0),
      speech_chars: Number(dailyAgg?.speech_chars ?? 0),
      stream_count: Number(dailyAgg?.stream_count ?? 0),
      ai_credits: Number(dailyAgg?.ai_credits ?? 0),
    },
    monthlyAggregate: {
      translate_count: Number(monthlyAgg?.translate_count ?? 0),
      transcribe_count: Number(monthlyAgg?.transcribe_count ?? 0),
      speech_chars: Number(monthlyAgg?.speech_chars ?? 0),
      stream_count: Number(monthlyAgg?.stream_count ?? 0),
      ai_credits: Number(monthlyAgg?.ai_credits ?? 0),
    },
    limit,
    offset,
    userId: userId || null,
  });
}

export async function handleAdminHealth(c: Context<AppEnv>) {
  const env = c.env;
  const names = Object.keys(PROVIDER_MODULES);
  const degradedResults = await Promise.all(
    names.map(async (name) => ({
      name,
      degraded: await isProviderDegraded(env, name).catch(() => false),
    })),
  );
  const degraded = degradedResults.filter((r) => r.degraded).map((r) => r.name);
  let d1 = "ok";
  let kv = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    d1 = "error";
  }
  try {
    await env.EKWE_KV.get("health:probe", { type: "text" });
  } catch {
    kv = "error";
  }
  const pushActive = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM push_tokens WHERE is_active = 1",
  )
    .first()
    .then((r) => (r as unknown as { n: number } | null)?.n ?? 0)
    .catch(() => 0);
  return c.json({
    status: "ok",
    timestamp: Date.now(),
    degradedProviders: degraded,
    bindings: { d1, kv },
    pushActive,
  });
}

export async function handleGetAdminManifest(c: Context<AppEnv>) {
  const raw = await c.env.EKWE_KV.get("update:manifest").catch(() => null);
  if (!raw) {
    return c.json({ manifest: null }, 200);
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return c.json({ manifest: parsed });
  } catch {
    return c.json({ manifest: null });
  }
}

export async function handleAuditWrite(c: Context<AppEnv>) {
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const body: unknown = await c.req.json().catch(() => null);
  await audit(
    c.env,
    adminEmail,
    "releases.action",
    body ? JSON.stringify(body).slice(0, 500) : null,
  );
  return c.json({ ok: true });
}

export async function handleBillingSync(c: Context<AppEnv>) {
  const adminEmail = c.get("adminEmail") ?? "unknown";
  try {
    const body = (await c.req.json().catch(() => ({}))) as { days?: number };
    const days = typeof body?.days === "number" ? body.days : 7;
    const result = await syncFlutterwaveBillingData(c.env, { days });
    await audit(
      c.env,
      adminEmail,
      "billing.sync",
      JSON.stringify({ days, ...result }).slice(0, 500),
    );
    return c.json({ ok: true, ...result });
  } catch (e) {
    logger.error("[admin-ops] billing sync failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return error(
      WORKER_ERROR_CODES.SERVER_ERROR,
      500,
      "Failed to sync billing data from Flutterwave.",
    );
  }
}
