import { useCallback, useEffect, useState } from "react";
import { siteConfig } from "../data/siteConfig";

const API = "/admin/api";
type Tab = "users" | "billing" | "usage" | "health" | "audit";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

interface AdminUser {
  id: string;
  email: string;
  tier: string;
  pro_expires_at: number | null;
  created_at: number;
}

interface Subscription {
  user_id: string;
  status: string;
  platform: string | null;
  expires_at: number | null;
}
interface Claim {
  flw_ref: string;
  user_id: string;
  amount: number | null;
  currency: string | null;
  claimed_at: number;
  expires_at: number;
}
interface UsageRow {
  user_id: string;
  day?: string;
  month?: string;
  translate_count: number;
  transcribe_count: number;
  speech_chars: number;
  ai_credits: number;
}
interface HealthRes {
  status: string;
  timestamp: number;
  degradedProviders: string[];
  bindings: { d1: string; kv: string };
  pushActive: number;
}
interface AuditRow {
  id: number;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  created_at: number;
}

function fmtDate(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString();
}

function UsersTab({
  q,
  setQ,
  tier,
  setTier,
  users,
  total,
  hasError,
  onPro,
}: {
  q: string;
  setQ: (v: string) => void;
  tier: string;
  setTier: (v: string) => void;
  users: AdminUser[];
  total: number;
  hasError: boolean;
  onPro: (id: string, isPro: boolean) => void;
}) {
  return (
    <>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by email…"
          aria-label="Filter users by email"
          style={{
            flex: "1 1 220px",
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
          }}
        />
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          aria-label="Filter by tier"
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">All tiers</option>
          <option value="FREE">FREE</option>
          <option value="PREMIUM">PREMIUM</option>
        </select>
      </div>
      {hasError ? (
        <p style={{ color: "var(--text-muted)" }}>
          User list unavailable until the API responds.
        </p>
      ) : (
        <>
          <p className="legal-date">{total} users</p>
          {users.length === 0 && <p>No users match.</p>}
        </>
      )}
      {users.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.9rem",
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8 }}>Email</th>
                <th style={{ textAlign: "left", padding: 8 }}>Tier</th>
                <th style={{ textAlign: "left", padding: 8 }}>Expires</th>
                <th style={{ textAlign: "left", padding: 8 }}>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: AdminUser) => {
                const isPro = u.tier === "PREMIUM";
                return (
                  <tr
                    key={u.id}
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td style={{ padding: 8 }}>{u.email}</td>
                    <td style={{ padding: 8 }}>{u.tier}</td>
                    <td style={{ padding: 8 }}>{fmtDate(u.pro_expires_at)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(u.created_at)}</td>
                    <td style={{ padding: 8 }}>
                      <button
                        type="button"
                        onClick={() => onPro(u.id, !isPro)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: isPro
                            ? "var(--bg-card)"
                            : "var(--accent)",
                          color: isPro
                            ? "var(--text-primary)"
                            : "var(--bg-primary)",
                          cursor: "pointer",
                        }}
                      >
                        {isPro ? "Revoke" : "Grant Pro"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [billing, setBilling] = useState<{
    subscriptions: Subscription[];
    claims: Claim[];
  }>({ subscriptions: [], claims: [] });
  const [usage, setUsage] = useState<{
    daily: UsageRow[];
    monthly: UsageRow[];
  }>({ daily: [], monthly: [] });
  const [health, setHealth] = useState<HealthRes | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (tier) params.set("tier", tier);
      const [u, b, us, h, a] = await Promise.allSettled([
        api<{ users?: AdminUser[]; total?: number }>(`/users?${params}`),
        api<{ subscriptions?: Subscription[]; claims?: Claim[] }>(
          "/billing?limit=50",
        ),
        api<{ daily?: UsageRow[]; monthly?: UsageRow[] }>("/usage?limit=50"),
        api<HealthRes>("/health"),
        api<{ entries?: AuditRow[] }>("/audit?limit=30"),
      ]);
      if (u.status === "fulfilled") {
        setUsers(u.value.users ?? []);
        setTotal(u.value.total ?? 0);
      }
      if (b.status === "fulfilled")
        setBilling({
          subscriptions: b.value.subscriptions ?? [],
          claims: b.value.claims ?? [],
        });
      if (us.status === "fulfilled")
        setUsage({
          daily: us.value.daily ?? [],
          monthly: us.value.monthly ?? [],
        });
      if (h.status === "fulfilled") setHealth(h.value);
      if (a.status === "fulfilled") setAudit(a.value.entries ?? []);
      if (u.status === "rejected") throw u.reason;
      setError(null);
      setLastSync(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [q, tier]);

  useEffect(() => {
    void loadAll();
    const id = setInterval(() => void loadAll(), 20_000);
    return () => clearInterval(id);
  }, [loadAll]);

  async function setPro(id: string, isPro: boolean) {
    if (
      !window.confirm(
        isPro
          ? "Grant lifetime Pro to this user?"
          : "Revoke Pro from this user?",
      )
    )
      return;
    try {
      await api(`/users/${id}/pro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPro, expiresAt: null }),
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Users" },
    { id: "billing", label: "Billing" },
    { id: "usage", label: "Usage" },
    { id: "health", label: "Health" },
    { id: "audit", label: "Audit" },
  ];

  return (
    <main className="legal">
      <div className="container">
        <h1>Admin — {siteConfig.app.name}</h1>
        <p className="legal-date">
          Protected by Cloudflare Access. Polls every 20s. Last sync:{" "}
          {lastSync || "—"}
        </p>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
          role="tablist"
          aria-label="Admin sections"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: tab === t.id ? "var(--accent)" : "var(--bg-card)",
                color:
                  tab === t.id ? "var(--bg-primary)" : "var(--text-primary)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {error && (
          <div className="admin-alert" role="alert">
            <strong>Could not load the dashboard.</strong>
            <span>{error}</span>
            <button type="button" onClick={() => loadAll()}>
              Retry
            </button>
          </div>
        )}

        {tab === "users" && (
          <UsersTab
            q={q}
            setQ={setQ}
            tier={tier}
            setTier={setTier}
            users={users}
            total={total}
            hasError={error !== null}
            onPro={setPro}
          />
        )}

        {tab === "billing" && (
          <>
            <h2 style={{ marginBottom: 12 }}>
              Subscriptions ({billing.subscriptions?.length ?? 0})
            </h2>
            {(billing.subscriptions ?? []).length === 0 && (
              <p>No subscriptions.</p>
            )}
            <div style={{ overflowX: "auto", marginBottom: 24 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>User</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Platform</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {(billing.subscriptions ?? []).map((s: Subscription) => (
                    <tr
                      key={s.user_id}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>{s.user_id.slice(0, 8)}…</td>
                      <td style={{ padding: 8 }}>{s.status}</td>
                      <td style={{ padding: 8 }}>{s.platform ?? "—"}</td>
                      <td style={{ padding: 8 }}>{fmtDate(s.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2 style={{ marginBottom: 12 }}>
              Flutterwave claims ({billing.claims?.length ?? 0})
            </h2>
            {(billing.claims ?? []).length === 0 && <p>No claims.</p>}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>Amount</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Currency</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Claimed</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {(billing.claims ?? []).map((c: Claim) => (
                    <tr
                      key={c.flw_ref}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>{c.amount}</td>
                      <td style={{ padding: 8 }}>{c.currency}</td>
                      <td style={{ padding: 8 }}>{fmtDate(c.claimed_at)}</td>
                      <td style={{ padding: 8 }}>{fmtDate(c.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "usage" && (
          <>
            <h2 style={{ marginBottom: 12 }}>
              Daily ({usage.daily?.length ?? 0})
            </h2>
            {(usage.daily ?? []).length === 0 && <p>No daily usage.</p>}
            <div style={{ overflowX: "auto", marginBottom: 24 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>User</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Day</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Translate</th>
                    <th style={{ textAlign: "left", padding: 8 }}>
                      Transcribe
                    </th>
                    <th style={{ textAlign: "left", padding: 8 }}>
                      Speech chars
                    </th>
                    <th style={{ textAlign: "left", padding: 8 }}>
                      AI credits
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(usage.daily ?? []).map((r: UsageRow, i: number) => (
                    <tr
                      key={i}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>{r.user_id.slice(0, 8)}…</td>
                      <td style={{ padding: 8 }}>{r.day}</td>
                      <td style={{ padding: 8 }}>{r.translate_count}</td>
                      <td style={{ padding: 8 }}>{r.transcribe_count}</td>
                      <td style={{ padding: 8 }}>{r.speech_chars}</td>
                      <td style={{ padding: 8 }}>{r.ai_credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2 style={{ marginBottom: 12 }}>
              Monthly ({usage.monthly?.length ?? 0})
            </h2>
            {(usage.monthly ?? []).length === 0 && <p>No monthly usage.</p>}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>User</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Month</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Translate</th>
                    <th style={{ textAlign: "left", padding: 8 }}>
                      Transcribe
                    </th>
                    <th style={{ textAlign: "left", padding: 8 }}>
                      Speech chars
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(usage.monthly ?? []).map((r: UsageRow, i: number) => (
                    <tr
                      key={i}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>{r.user_id.slice(0, 8)}…</td>
                      <td style={{ padding: 8 }}>{r.month}</td>
                      <td style={{ padding: 8 }}>{r.translate_count}</td>
                      <td style={{ padding: 8 }}>{r.transcribe_count}</td>
                      <td style={{ padding: 8 }}>{r.speech_chars}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "health" &&
          (health ? (
            <>
              <p>
                Status: <strong>{health.status}</strong> · D1:{" "}
                {health.bindings?.d1} · KV: {health.bindings?.kv} · Active push
                tokens: {health.pushActive ?? 0}
              </p>
              <p>
                Degraded:{" "}
                {health.degradedProviders?.length
                  ? health.degradedProviders.join(", ")
                  : "none"}
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                From {new Date(health.timestamp).toLocaleString()}
              </p>
            </>
          ) : (
            <p>Loading health…</p>
          ))}

        {tab === "audit" && (
          <>
            <h2 style={{ marginBottom: 12 }}>Audit log ({audit.length})</h2>
            {audit.length === 0 && <p>No entries.</p>}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.85rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>When</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Admin</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Action</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((r: AuditRow) => (
                    <tr
                      key={r.id}
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: 8 }}>
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: 8 }}>{r.admin_email}</td>
                      <td style={{ padding: 8 }}>{r.action}</td>
                      <td style={{ padding: 8 }}>
                        {r.target_user_id
                          ? `${String(r.target_user_id).slice(0, 8)}…`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
